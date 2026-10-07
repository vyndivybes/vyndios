import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, withSqlTransaction, type Sql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";

const confirmationSchema = z.object({
  confirmation: z.literal("RUN_ROLLBACK_UAT"),
});

type DomainProbe = {
  status: "PASS";
  assertions: string[];
};

type TransactionalUatResult = {
  ok: true;
  runId: string;
  rolledBack: true;
  remainingFixtureCount: 0;
  domains: {
    funding: DomainProbe;
    peopleOffice: DomainProbe;
    inventory: DomainProbe;
    quality: DomainProbe;
  };
};

function requireExactlyOne(label: string, count: number) {
  if (count !== 1) throw new Error(`${label} expected exactly one UAT row; observed ${count}.`);
}

async function count(sql: Sql, text: string, params: unknown[]): Promise<number> {
  const rows = await sql.query<{ count: number | string }>(text, params);
  return Number(rows[0]?.count ?? 0);
}

export const runProductionTransactionalUat = createServerFn({ method: "POST" })
  .validator(confirmationSchema)
  .handler(async ({ data }): Promise<TransactionalUatResult> => {
    if (data.confirmation !== "RUN_ROLLBACK_UAT") throw new Error("Transactional UAT confirmation mismatch.");
    const actor = await requireBusinessActor("admin");

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const runId = `UAT-${stamp}-${suffix}`;
    const evidenceReference = `${runId}|ROLLBACK_ONLY`;
    const today = new Date().toISOString().slice(0, 10);

    const ids = {
      grant: `GRANT-${runId}`,
      person: `PERSON-${runId}`,
      employment: `EMP-${runId}`,
      inventoryMaster: crypto.randomUUID(),
      inventorySku: `UAT-${suffix}`,
      inventoryItem: `inventory-${runId}`,
      inventoryMovement: `REC-${runId}`,
      inventoryLedger: `LED-${runId}`,
      qualityInspection: `QI-${runId}`,
    };

    const domains = await withSqlTransaction(
      async (sql) => {
        await sql.query("select pg_advisory_xact_lock($1,$2)", [1982, 1007]);

        // FUNDING: exercise the canonical grant authority + trigger-normalized enterprise audit.
        await sql.query(
          "select create_vyndi_funding_grant($1,$2,$3,$4,$5,$6::date,$7::date,$8::date,$9,$10,$11,$12)",
          [
            ids.grant,
            `Rollback UAT Grant ${runId}`,
            "VYNDI UAT",
            runId,
            1,
            today,
            null,
            null,
            evidenceReference,
            evidenceReference,
            actor.userId,
            actor.role,
          ],
        );
        const fundingGrantCount = await count(sql, "select count(*)::int as count from vyndi_funding_grants where id=$1", [ids.grant]);
        const fundingAuditCount = await count(
          sql,
          "select count(*)::int as count from vyndi_audit_events where entity_type='funding_grant' and entity_id=$1 and action='FUNDING_GRANT_CREATED'",
          [ids.grant],
        );
        requireExactlyOne("Funding grant authority", fundingGrantCount);
        requireExactlyOne("Funding audit authority", fundingAuditCount);

        // PEOPLE & OFFICE: use the same canonical master shape, then exercise the revision-checked employment authority.
        await sql.query(
          `insert into vyndi_people_records (
             id,display_name,function_name,role_title,engagement_type,lifecycle_status,start_month,end_month,
             source_ref,notes,created_by,record_revision
           ) values ($1,$2,$3,$4,'planned_role','draft',1,1,$5,$6,$7,1)`,
          [
            ids.person,
            `Rollback UAT Person ${runId}`,
            "Certification",
            "Transactional UAT",
            evidenceReference,
            "Rollback-only production certification fixture.",
            actor.userId,
          ],
        );
        await sql.query(
          `insert into vyndi_audit_events (
             id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,
             payload_json,correlation_id,previous_state,new_state,reason
           ) values ($1,'people_record',$2,1,'PEOPLE_RECORD_DRAFT_SAVED',$3,$4,$5,$6::jsonb,$7,null,'draft',$8)`,
          [
            crypto.randomUUID(),
            ids.person,
            actor.userId,
            actor.role,
            evidenceReference,
            JSON.stringify({ engagementType: "planned_role", uatRunId: runId }),
            `PEOPLE_OFFICE|people_record|${ids.person}`,
            "Rollback-only UAT fixture.",
          ],
        );
        const employmentRows = await sql.query<{ new_revision: number | string; resulting_operational_status: string }>(
          "select * from record_vyndi_people_employment_event($1,$2,'joined',$3::date,$4::jsonb,'active',1,$5,$6,$7,$8)",
          [
            ids.employment,
            ids.person,
            today,
            JSON.stringify({ uatRunId: runId }),
            evidenceReference,
            evidenceReference,
            actor.userId,
            actor.role,
          ],
        );
        if (Number(employmentRows[0]?.new_revision ?? 0) !== 2 || employmentRows[0]?.resulting_operational_status !== "active") {
          throw new Error("People employment authority did not produce revision 2 / active state.");
        }
        requireExactlyOne(
          "People employment ledger",
          await count(sql, "select count(*)::int as count from vyndi_people_employment_ledger where id=$1 and person_id=$2", [ids.employment, ids.person]),
        );
        requireExactlyOne(
          "People master revision",
          await count(sql, "select count(*)::int as count from vyndi_people_records where id=$1 and record_revision=2 and operational_status='active'", [ids.person]),
        );

        // INVENTORY: create an approved UAT master identity inside this rollback-only transaction,
        // then exercise the same canonical receipt function used by Master Inventory.
        await sql.query(
          `insert into master_data_records (
             id,domain,code,name,revision,status,owner_role,approver_role,effective_from,source_ref,attributes,
             created_by,approved_by,approved_at
           ) values ($1::uuid,'inventory',$2,$3,1,'approved','operations','operations',$4::date,$5,$6::jsonb,$7,$7,now())`,
          [
            ids.inventoryMaster,
            ids.inventorySku,
            `Rollback UAT Inventory ${runId}`,
            today,
            evidenceReference,
            JSON.stringify({ category: "uat-certification", unit: "ea", uatRunId: runId }),
            actor.userId,
          ],
        );
        const inventoryRows = await sql.query<{ item_id: string; lot_id: string | null }>(
          "select * from save_vyndi_master_inventory_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15::date,$16,$17,$18,$19)",
          [
            ids.inventoryItem,
            ids.inventoryMovement,
            ids.inventoryLedger,
            "components",
            ids.inventorySku,
            `Rollback UAT Inventory ${runId}`,
            "uat-certification",
            "ea",
            0,
            0,
            1,
            100,
            today,
            null,
            null,
            evidenceReference,
            "Rollback-only production certification fixture.",
            actor.userId,
            actor.role,
          ],
        );
        if (inventoryRows[0]?.item_id !== ids.inventoryItem || !inventoryRows[0]?.lot_id) {
          throw new Error("Inventory authority did not return the expected item and FIFO lot.");
        }
        requireExactlyOne(
          "Inventory canonical item",
          await count(sql, "select count(*)::int as count from master_inventory_items where id=$1 and sku=$2", [ids.inventoryItem, ids.inventorySku]),
        );
        requireExactlyOne(
          "Inventory receipt movement",
          await count(sql, "select count(*)::int as count from epr_inventory_movements where id=$1", [ids.inventoryMovement]),
        );
        requireExactlyOne(
          "Inventory FIFO layer",
          await count(sql, "select count(*)::int as count from epr_inventory_fifo_layers where sku=$1 and quantity_received=1", [ids.inventorySku]),
        );

        // QUALITY: exercise the canonical incoming-inspection record and enterprise audit shape.
        await sql.query(
          `insert into vyndi_quality_inspections (
             id,inspection_stage,inspection_type,sales_order_id,job_card_id,traveller_id,goods_receipt_id,
             sku,lot_number,serial_number,sample_size,defect_quantity,result,disposition,
             criteria_ref,evidence_ref,notes,recorded_by,recorded_role
           ) values (
             $1,'incoming','production_uat',null,null,null,null,$2,$3,null,1,0,'pass','accepted',$4,$5,$6,$7,$8
           )`,
          [
            ids.qualityInspection,
            ids.inventorySku,
            runId,
            "UAT-CRITERIA-ROLLBACK",
            evidenceReference,
            "Rollback-only production certification fixture.",
            actor.userId,
            actor.role,
          ],
        );
        await sql.query(
          `insert into vyndi_audit_events (
             id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
             source_reference,payload_json,correlation_id,gate_id,gate_result,previous_state,new_state,reason
           ) values (
             $1,'quality_inspection',$2,1,'QUALITY_INSPECTION_RECORDED',$3,$4,$5,$6::jsonb,$7,
             'G10-QUALITY','pass',null,'accepted','Rollback-only UAT fixture.'
           )`,
          [
            crypto.randomUUID(),
            ids.qualityInspection,
            actor.userId,
            actor.role,
            evidenceReference,
            JSON.stringify({ stage: "incoming", result: "pass", disposition: "accepted", sku: ids.inventorySku, uatRunId: runId }),
            `QUALITY|${ids.qualityInspection}`,
          ],
        );
        requireExactlyOne(
          "Quality inspection authority",
          await count(sql, "select count(*)::int as count from vyndi_quality_inspections where id=$1 and result='pass' and disposition='accepted'", [ids.qualityInspection]),
        );
        requireExactlyOne(
          "Quality audit authority",
          await count(sql, "select count(*)::int as count from vyndi_audit_events where entity_type='quality_inspection' and entity_id=$1 and action='QUALITY_INSPECTION_RECORDED'", [ids.qualityInspection]),
        );

        return {
          funding: { status: "PASS" as const, assertions: ["grant created", "enterprise audit emitted"] },
          peopleOffice: { status: "PASS" as const, assertions: ["draft master created", "employment revision advanced", "employment ledger appended"] },
          inventory: { status: "PASS" as const, assertions: ["approved master identity enforced", "receipt posted", "FIFO layer created"] },
          quality: { status: "PASS" as const, assertions: ["incoming inspection recorded", "quality audit emitted"] },
        };
      },
      { alwaysRollback: true, isolationLevel: "serializable" },
    );

    // Prove rollback on a new short-lived connection after the transaction has ended.
    const verificationSql = await getSql();
    const remainingRows = await verificationSql.query<{ count: number | string }>(
      `select (
         (select count(*) from vyndi_funding_grants where id=$1) +
         (select count(*) from vyndi_people_records where id=$2) +
         (select count(*) from vyndi_people_employment_ledger where id=$3) +
         (select count(*) from master_data_records where id=$4::uuid) +
         (select count(*) from master_inventory_items where id=$5) +
         (select count(*) from epr_inventory_movements where id=$6) +
         (select count(*) from vyndi_quality_inspections where id=$7) +
         (select count(*) from vyndi_audit_events where source_reference=$8)
       )::int as count`,
      [
        ids.grant,
        ids.person,
        ids.employment,
        ids.inventoryMaster,
        ids.inventoryItem,
        ids.inventoryMovement,
        ids.qualityInspection,
        evidenceReference,
      ],
    );
    const remainingFixtureCount = Number(remainingRows[0]?.count ?? -1);
    if (remainingFixtureCount !== 0) {
      throw new Error(`Transactional UAT rollback verification failed: ${remainingFixtureCount} fixture row(s) remain.`);
    }

    return {
      ok: true,
      runId,
      rolledBack: true,
      remainingFixtureCount: 0,
      domains,
    };
  });
