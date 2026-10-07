import { createHash } from "node:crypto";

function canonical(value){
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==="object" && !(value instanceof Date)){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  }
  return value;
}

export function recoveryHash(value){
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

async function rows(client,sql,params=[]){
  const result=await client.query(sql,params);
  return result.rows;
}

function scope(records,{bytes=0}={}){
  return {count:records.length,bytes,hash:recoveryHash(records),records};
}

export async function captureRecoveryQualificationSnapshot(client){
  const [
    migrations,
    salesOrder,
    salesOrderRevisions,
    monthlyActual,
    people,
    attendance,
    leave,
    expenditure,
    quality,
    attachmentRows,
    audits,
  ]=await Promise.all([
    rows(client,"select name from _migrations order by name"),
    rows(client,"select id,revision,plan_month,product_id,units,asp_lakh,channel,status,model_tier,variant_id,variant_name,configuration,created_by,updated_by from vyndi_sales_orders where id='H2-SO-BASE'"),
    rows(client,"select id,sales_order_id,revision,snapshot,change_reason,actor_user_id,actor_role from vyndi_sales_order_revisions where sales_order_id='H2-SO-BASE' order by revision"),
    rows(client,"select plan_month,revision,revenue,units,cogs,opex,closing_cash,inventory,receivables,payables,source_reference,verified,updated_by from vyndi_monthly_actuals where plan_month=35"),
    rows(client,"select id,display_name,function_name,role_title,engagement_type,lifecycle_status,operational_status,record_revision,source_ref from vyndi_people_records where id='H2-PERSON'"),
    rows(client,"select person_id,work_date,revision,attendance_status,worked_hours,overtime_hours,evidence_ref from vyndi_people_attendance_current where person_id='H2-PERSON' order by work_date"),
    rows(client,"select person_id,leave_type,balance_days,last_effective_on from vyndi_people_leave_balance where person_id='H2-PERSON' order by leave_type"),
    rows(client,"select id,source_type,source_id,source_label,source_category,plan_month,incurred_on,description,amount_inr,lifecycle_status,source_reference from vyndi_people_office_actual_expenditures where id='H2-EXPENSE'"),
    rows(client,"select id,inspection_stage,inspection_type,sales_order_id,sku,sample_size,defect_quantity,result,disposition,criteria_ref,evidence_ref,recorded_by,recorded_role from vyndi_quality_inspections where id='H2-Q-INCOMING'"),
    rows(client,"select id,expenditure_id,document_type,file_name,mime_type,file_size_bytes,sha256_hex,encode(content_bytes,'hex') as content_hex,uploaded_by,uploaded_role from vyndi_expense_evidence_attachments where id='H2-ATTACHMENT'"),
    rows(client,"select id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json from vyndi_audit_events where entity_id in ('H2-SO-BASE','H2-EXPENSE') or actor_user_id in ('h2-operator','h2-cash-controller','h2-people','h2-quality') order by id"),
  ]);

  const commercial=scope([...salesOrder,...salesOrderRevisions]);
  const finance=scope(monthlyActual);
  const peopleOffice=scope([...people,...attendance,...leave,...expenditure]);
  const qualityScope=scope(quality);
  const configuration=scope(salesOrder.map(row=>({
    id:row.id,
    model_tier:row.model_tier,
    variant_id:row.variant_id,
    variant_name:row.variant_name,
    configuration:row.configuration,
  })));
  const attachmentBytes=attachmentRows.reduce((sum,row)=>sum+Number(row.file_size_bytes||0),0);
  const attachments=scope(attachmentRows,{bytes:attachmentBytes});
  const audit=scope(audits);

  const scopes={commercial,finance,peopleOffice,quality:qualityScope,configuration,attachments,audit};
  const domainHashes=Object.fromEntries(Object.entries(scopes).map(([name,value])=>[name,value.hash]));
  const critical={
    commercial:commercial.records,
    finance:finance.records,
    peopleOffice:peopleOffice.records,
    quality:qualityScope.records,
    configuration:configuration.records,
    attachments:attachments.records,
    audit:audit.records,
  };
  return {
    migrationCount:migrations.length,
    migrationHash:recoveryHash(migrations),
    scopes,
    domainHashes,
    critical,
    hash:recoveryHash({migrationHash:recoveryHash(migrations),domainHashes}),
  };
}

export function compareRecoveryQualificationSnapshots(source,restored){
  const scopeNames=["commercial","finance","peopleOffice","quality","configuration","attachments","audit"];
  const matches=Object.fromEntries(scopeNames.map(name=>[
    name,
    source.scopes[name].hash===restored.scopes[name].hash
      && source.scopes[name].count===restored.scopes[name].count
      && source.scopes[name].bytes===restored.scopes[name].bytes,
  ]));
  return {
    matches,
    allMatched:Object.values(matches).every(Boolean),
    multiDepartmentRestore:["commercial","finance","peopleOffice","quality"].every(name=>matches[name]),
    configurationHashMatch:matches.configuration,
    attachmentHashMatch:source.scopes.attachments.hash===restored.scopes.attachments.hash,
    attachmentBytesMatch:source.scopes.attachments.bytes===restored.scopes.attachments.bytes,
  };
}
