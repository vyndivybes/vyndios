import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,"..");
const migrationsDir=join(root,"migrations");

async function db() {
  const instance=new PGlite();
  await instance.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])) {
    await instance.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  }
  return instance;
}

async function user(database,id,email,role) {
  await database.query(
    `insert into "user" ("id","name","email","emailVerified","createdAt","updatedAt")
     values($1,$2,$3,true,now(),now())`,
    [id,id,email],
  );
  await database.query(
    `insert into vindy_user_roles(user_id,role) values($1,$2)`,
    [id,role],
  );
}

test("H4 maker/checker role change cannot be self-approved and preserves immutable access lineage", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await user(database,"ADMIN-A","admin-a@vyndi.test","admin");
  await user(database,"ADMIN-B","admin-b@vyndi.test","admin");
  await user(database,"TARGET","target@vyndi.test","viewer");

  const requested=await database.query(
    `select * from request_vyndi_role_change($1,$2,$3,$4,$5,$6)`,
    ["ACCESS-1","TARGET","finance","Finance responsibility assigned","ADMIN-A","admin"],
  );
  assert.equal(requested.rows[0].from_role,"viewer");
  assert.equal(requested.rows[0].to_role,"finance");

  const unchanged=await database.query(`select role from vindy_user_roles where user_id='TARGET'`);
  assert.equal(unchanged.rows[0].role,"viewer","request must not change current access");

  await assert.rejects(
    ()=>database.query(
      `select * from decide_vyndi_role_change($1,'approve',$2,$3,$4)`,
      ["ACCESS-1","self approval","ADMIN-A","admin"],
    ),
    /different administrator/i,
  );

  const approved=await database.query(
    `select * from decide_vyndi_role_change($1,'approve',$2,$3,$4)`,
    ["ACCESS-1","Independent checker approval","ADMIN-B","admin"],
  );
  assert.equal(approved.rows[0].applied_role,"finance");
  assert.equal(approved.rows[0].request_status,"applied");

  const role=await database.query(`select role from vindy_user_roles where user_id='TARGET'`);
  assert.equal(role.rows[0].role,"finance");

  const events=await database.query(
    `select event_type,actor_user_id,role_before,role_after
       from vyndi_access_events where target_user_id='TARGET' order by created_at,id`,
  );
  assert.deepEqual(events.rows.map(row=>row.event_type),["role_change_requested","role_change_approved"]);
  assert.equal(events.rows[0].actor_user_id,"ADMIN-A");
  assert.equal(events.rows[1].actor_user_id,"ADMIN-B");
  assert.equal(events.rows[1].role_before,"viewer");
  assert.equal(events.rows[1].role_after,"finance");

  await assert.rejects(
    ()=>database.query(`update vyndi_access_events set reason='tampered' where target_user_id='TARGET'`),
    /append-only/i,
  );
  await assert.rejects(
    ()=>database.query(`delete from vyndi_access_events where target_user_id='TARGET'`),
    /append-only/i,
  );

  const genericAudit=await database.query(
    `select count(*)::int as count from vyndi_audit_events
      where entity_type='access_control' and entity_id='TARGET'`,
  );
  assert.equal(Number(genericAudit.rows[0].count),2);
});

test("H4 break-glass is explicit, flagged, and certification evidence is immutable", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await user(database,"ADMIN-A","admin-a@vyndi.test","admin");
  await user(database,"TARGET","target@vyndi.test","viewer");

  await database.query(
    `select * from request_vyndi_role_change($1,$2,$3,$4,$5,$6)`,
    ["ACCESS-EMERGENCY","TARGET","operations","Emergency production coverage","ADMIN-A","admin"],
  );

  await assert.rejects(
    ()=>database.query(
      `select * from emergency_apply_vyndi_role_change($1,$2,$3,$4)`,
      ["ACCESS-EMERGENCY","","ADMIN-A","admin"],
    ),
    /Break-glass reason is required/i,
  );

  const applied=await database.query(
    `select * from emergency_apply_vyndi_role_change($1,$2,$3,$4)`,
    ["ACCESS-EMERGENCY","Only bootstrap administrator available during controlled test","ADMIN-A","admin"],
  );
  assert.equal(applied.rows[0].applied_role,"operations");

  const request=await database.query(
    `select status,emergency_override,decided_by from vyndi_access_role_change_requests where id='ACCESS-EMERGENCY'`,
  );
  assert.equal(request.rows[0].status,"applied");
  assert.equal(request.rows[0].emergency_override,true);
  assert.equal(request.rows[0].decided_by,"ADMIN-A");

  const emergency=await database.query(
    `select event_type,metadata_json from vyndi_access_events where target_user_id='TARGET' and event_type='role_change_emergency'`,
  );
  assert.equal(emergency.rows.length,1);
  assert.equal(emergency.rows[0].metadata_json.emergencyOverride,true);

  const snapshot={users:[{id:"TARGET",role:"operations",activeSessions:0}],exceptions:[{code:"BREAK_GLASS_REVIEW"}]};
  const certification=await database.query(
    `select capture_vyndi_access_certification($1,$2,$3::jsonb,$4,$5,$6) as id`,
    ["ACCESS-CERT-1","H4-TEST-CERT",JSON.stringify(snapshot),1,"ADMIN-A","admin"],
  );
  assert.equal(certification.rows[0].id,"ACCESS-CERT-1");

  await assert.rejects(
    ()=>database.query(`update vyndi_access_certifications set exception_count=0 where id='ACCESS-CERT-1'`),
    /append-only/i,
  );
  await assert.rejects(
    ()=>database.query(`delete from vyndi_access_certifications where id='ACCESS-CERT-1'`),
    /append-only/i,
  );
});

test("H4 access source enforces bootstrap-only server break-glass and never records credential material", async()=>{
  const [authority,users,route,migration]=await Promise.all([
    readFile(join(root,"src/lib/access-governance.ts"),"utf8"),
    readFile(join(root,"src/lib/vindy-users.ts"),"utf8"),
    readFile(join(root,"src/routes/command/users.tsx"),"utf8"),
    readFile(join(root,"migrations/0086_access_governance.sql"),"utf8"),
  ]);

  assert.match(authority,/if\(!actor\.bootstrapAdmin\) throw new Error\("Break-glass access is restricted/);
  assert.match(authority,/makerCheckerRequired:true/);
  assert.match(users,/Resolve the pending role-change request before deleting this user/);
  assert.match(users,/eventType: "password_reset"/);
  assert.doesNotMatch(migration,/password_hash|access_token|refresh_token|session_token/i);
  assert.doesNotMatch(authority,/passwordHash|bearerToken|refreshToken/i);
  assert.match(route,/different administrator must approve/i);
  assert.match(route,/Capture certification/);
  assert.match(route,/Break-glass apply/);
});

test("H4 retains one-role-per-user SoD boundary", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await user(database,"TARGET","target@vyndi.test","viewer");
  await database.query(
    `insert into vindy_user_roles(user_id,role) values('TARGET','finance')
       on conflict(user_id) do update set role=excluded.role,updated_at=now()`,
  );
  const rows=await database.query(`select user_id,role from vindy_user_roles where user_id='TARGET'`);
  assert.equal(rows.rows.length,1);
  assert.equal(rows.rows[0].role,"finance");
});
