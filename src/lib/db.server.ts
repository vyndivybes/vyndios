import { getRequest } from "@tanstack/react-start/server";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import { expectedRuntimeMigrationNames, planRuntimeSchemaMigrations } from "./runtime-schema-migrations";
import {
  isLoopbackPostgresConnectionString,
  requestSafePostgresPoolConfig,
} from "./postgres-pool";
import {
  resolvePostgresTransport,
  type PostgresTransport,
} from "./postgres-runtime";
import type { Sql, SqlRow } from "./db.ts";

const globalRef = globalThis as typeof globalThis & {
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
  __hyperdriveMigrationReady__?: Promise<void>;
};

/**
 * A deployed Worker may serve many requests from the same module isolate, but
 * request-bound network I/O objects must stay inside the request that created
 * them. Keying by the ambient Request gives Workers one SQL facade per request
 * while allowing nested server functions in that request to share it.
 *
 * Local workerd is stricter than Node about socket ownership. A loopback
 * PostgreSQL URL therefore uses a fresh pg.Client for every query and closes it
 * before that query resolves. No loopback socket or pg.Pool survives beyond the
 * request/query context that created it.
 */
const requestSqlCache = new WeakMap<Request, Promise<Sql>>();

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

const bundledMigrations=import.meta.glob("/migrations/*.sql",{
  query:"?raw",
  import:"default",
  eager:true,
}) as Record<string,string>;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

export class RuntimeSchemaMigrationError extends Error {
  migrationName:string|null;
  sqlState:string|null;
  stage:"connect"|"bootstrap"|"apply"|"unlock";

  constructor(input:{
    stage:"connect"|"bootstrap"|"apply"|"unlock";
    migrationName?:string|null;
    sqlState?:string|null;
    cause?:unknown;
  }){
    const migrationPart=input.migrationName?": "+input.migrationName:"";
    const statePart=input.sqlState?" ["+input.sqlState+"]":"";
    super("Runtime schema migration failed during "+input.stage+migrationPart+statePart,{cause:input.cause});
    this.name="RuntimeSchemaMigrationError";
    this.stage=input.stage;
    this.migrationName=input.migrationName??null;
    this.sqlState=input.sqlState??null;
  }
}

function sqlStateOf(error:unknown):string|null{
  if(!error||typeof error!=="object") return null;
  const code=(error as {code?:unknown}).code;
  return typeof code==="string"&&code.trim()?code.trim():null;
}

export function safeRuntimeSchemaMigrationFailure(error:unknown){
  if(error instanceof RuntimeSchemaMigrationError){
    return {stage:error.stage,migrationName:error.migrationName,sqlState:error.sqlState};
  }
  return {stage:"unknown" as const,migrationName:null,sqlState:sqlStateOf(error)};
}

async function ensureHyperdriveSchemaReady(transport: PostgresTransport):Promise<void>{
  if(transport.source!=="hyperdrive") return;

  globalRef.__hyperdriveMigrationReady__ ??= (async()=>{
    const { Client }=await import("pg");
    const client=new Client({connectionString:transport.connectionString});

    try{
      try{
        await client.connect();
      }catch(error){
        throw new RuntimeSchemaMigrationError({stage:"connect",cause:error,sqlState:sqlStateOf(error)});
      }

      for(;;){
        let inTransaction=false;
        let migrationName:string|null=null;
        try{
          await client.query("BEGIN");
          inTransaction=true;
          await client.query("select pg_advisory_xact_lock($1,$2)",[1982,1505]);
          // Production migrations own schema DDL. Hyperdrive intentionally uses a
          // restricted runtime role, so readiness must only read the ledger here.
          // A missing ledger still fails closed via SELECT (42P01) instead of
          // requiring CREATE privilege on every application request.
          const appliedRows=await client.query<{name:string}>("select name from _migrations");
          const plan=planRuntimeSchemaMigrations({
            transportSource:"hyperdrive",
            migrations:bundledMigrations,
            applied:appliedRows.rows.map((row)=>row.name),
          });

          if(!plan.allowed&&plan.blocked.length){
            const first=plan.blocked[0]!;
            throw new RuntimeSchemaMigrationError({
              stage:"apply",
              migrationName:first.name,
              sqlState:"DESTRUCTIVE_BLOCKED",
              cause:new Error(first.classes.join(", ")),
            });
          }

          const migration=plan.pending[0];
          if(!migration){
            await client.query("COMMIT");
            inTransaction=false;
            break;
          }

          migrationName=migration.name;
          if(!migration.sql.trim()){
            throw new RuntimeSchemaMigrationError({
              stage:"apply",
              migrationName,
              sqlState:"EMPTY_MIGRATION",
            });
          }

          await client.query(migration.sql);
          await client.query(
            "insert into _migrations(name) values($1) on conflict(name) do nothing",
            [migration.name],
          );
          await client.query("COMMIT");
          inTransaction=false;
          console.log("[db] runtime Hyperdrive reconciliation applied "+migration.name);
        }catch(error){
          if(inTransaction){
            try{await client.query("ROLLBACK");}catch{/* best-effort rollback */}
          }
          if(error instanceof RuntimeSchemaMigrationError) throw error;
          throw new RuntimeSchemaMigrationError({
            stage:migrationName?"apply":"bootstrap",
            migrationName,
            sqlState:sqlStateOf(error),
            cause:error,
          });
        }
      }
    }finally{
      try{await client.end();}catch{/* best-effort connection cleanup */}
    }
  })().catch((error)=>{
    globalRef.__hyperdriveMigrationReady__=undefined;
    throw error;
  });

  await globalRef.__hyperdriveMigrationReady__;
}

export async function readRuntimeSchemaMigrationStatus(sql:Sql){
  const expected=expectedRuntimeMigrationNames(bundledMigrations);
  const appliedRows=await sql.query<{name:string}>("select name from _migrations");
  const appliedSet=new Set(appliedRows.map((row)=>row.name));
  const appliedExpected=expected.filter((name)=>appliedSet.has(name));
  const pending=expected.filter((name)=>!appliedSet.has(name));
  return {
    expectedMigrationCount:expected.length,
    appliedMigrationCount:appliedExpected.length,
    pendingMigrationCount:pending.length,
    latestExpectedMigration:expected.at(-1)??null,
    latestAppliedMigration:appliedExpected.at(-1)??null,
  };
}

export async function getRuntimeSchemaDiagnosticServer(){
  const transport=await resolvePostgresTransport();
  try{
    if(!transport){
      const sql=await createPgliteSql();
      return {ok:true,source:"pglite" as const,...await readRuntimeSchemaMigrationStatus(sql),failure:null};
    }
    if(transport.source==="hyperdrive") await ensureHyperdriveSchemaReady(transport);
    const sql=await createPostgresSql(transport);
    return {ok:true,source:transport.source,...await readRuntimeSchemaMigrationStatus(sql),failure:null};
  }catch(error){
    return {
      ok:false,
      source:transport?.source??"pglite",
      expectedMigrationCount:expectedRuntimeMigrationNames(bundledMigrations).length,
      appliedMigrationCount:null,
      pendingMigrationCount:null,
      latestExpectedMigration:expectedRuntimeMigrationNames(bundledMigrations).at(-1)??null,
      latestAppliedMigration:null,
      failure:safeRuntimeSchemaMigrationFailure(error),
    };
  }
}

function toSql(run: Run): Sql {
  const sql = (async <T = SqlRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = SqlRow>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

/**
 * Build the request-local SQL facade.
 *
 * - local/loopback PostgreSQL: one pg.Client per query, fully connected and
 *   closed inside that query's request context;
 * - deployed/non-loopback PostgreSQL: a small request-local pg.Pool, with each
 *   checked-out connection retired after one query. Hyperdrive remains the
 *   shared cross-request pool in deployed Cloudflare environments.
 */
async function createPostgresSql(transport: PostgresTransport): Promise<Sql> {
  const { Client, Pool, types } = await import("pg");
  types.setTypeParser(OID_INT8, Number);
  types.setTypeParser(OID_DATE, identity);
  types.setTypeParser(OID_INTERVAL, identity);

  if (isLoopbackPostgresConnectionString(transport.connectionString)) {
    return toSql(async <T>(text: string, params: unknown[]) => {
      const client = new Client({ connectionString: transport.connectionString });
      await client.connect();
      try {
        const res = await client.query(text, params);
        return res.rows as T[];
      } finally {
        await client.end();
      }
    });
  }

  const pool = new Pool(requestSafePostgresPoolConfig(transport.connectionString));
  return toSql(async <T>(text: string, params: unknown[]) => {
    const res = await pool.query(text, params);
    return res.rows as T[];
  });
}

async function createPgliteSql(): Promise<Sql> {
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite({
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>("select name from _migrations");
    const done = doneRows.rows.map((r) => r.name);
    for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
      await pg.transaction(async (tx) => {
        await tx.exec(migrations[path]);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined)
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows as T[];
  });
}

export async function getSqlServer(): Promise<Sql> {
  const transport = await resolvePostgresTransport();
  if (!transport) return createPgliteSql();

  await ensureHyperdriveSchemaReady(transport);

  const request = getRequest();
  if (!request) return createPostgresSql(transport);

  const cached = requestSqlCache.get(request);
  if (cached) return cached;

  const pending = createPostgresSql(transport).catch((error) => {
    requestSqlCache.delete(request);
    throw error;
  });
  requestSqlCache.set(request, pending);
  return pending;
}

export async function getPgliteServer(): Promise<import("@electric-sql/pglite").PGlite> {
  const transport = await resolvePostgresTransport();
  if (transport) {
    throw new Error("getPglite() is only available when neither Hyperdrive nor DATABASE_URL is configured");
  }
  await getSqlServer();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

export async function ensureDbReadyServer(): Promise<void> {
  const transport = await resolvePostgresTransport();
  if (transport) return;
  await getSqlServer();
}

const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
globalBoot.__pgBootstrapPromise__ ??= ensureDbReadyServer().catch((err) => {
  globalBoot.__pgBootstrapPromise__ = undefined;
  console.error("[db] bootstrap failed:", err);
  throw err;
});
