import { getRequest } from "@tanstack/react-start/server";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import { expectedRuntimeMigrationNames } from "./runtime-schema-migrations";
import { createRequestPostgresLimiter } from "./postgres-pool";
import {
  resolvePostgresTransport,
  type PostgresTransport,
} from "./postgres-runtime";
import type { Sql, SqlRow } from "./db.ts";

const globalRef = globalThis as typeof globalThis & {
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
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
    firstPendingMigration:pending[0]??null,
  };
}

export async function getRuntimeSchemaDiagnosticServer(){
  const transport=await resolvePostgresTransport();
  try{
    const sql=transport ? await createPostgresSql(transport) : await createPgliteSql();
    const status=await readRuntimeSchemaMigrationStatus(sql);
    const schemaCurrent=status.pendingMigrationCount===0;
    return {
      ok:schemaCurrent,
      source:transport?.source??"pglite",
      ...status,
      failure:schemaCurrent
        ? null
        : {
            stage:"apply" as const,
            migrationName:status.firstPendingMigration,
            sqlState:"SCHEMA_LAG",
          },
    };
  }catch(error){
    return {
      ok:false,
      source:transport?.source??"pglite",
      expectedMigrationCount:expectedRuntimeMigrationNames(bundledMigrations).length,
      appliedMigrationCount:null,
      pendingMigrationCount:null,
      latestExpectedMigration:expectedRuntimeMigrationNames(bundledMigrations).at(-1)??null,
      latestAppliedMigration:null,
      firstPendingMigration:null,
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
 * All PostgreSQL transports use a short-lived pg.Client per query. A
 * request-local semaphore bounds aggregate concurrency while Hyperdrive remains
 * the shared cross-request connection pool in deployed Cloudflare environments.
 * No pg.Pool or socket-bearing client survives a completed query.
 */
async function createPostgresSql(transport: PostgresTransport): Promise<Sql> {
  const { Client, types } = await import("pg");
  types.setTypeParser(OID_INT8, Number);
  types.setTypeParser(OID_DATE, identity);
  types.setTypeParser(OID_INTERVAL, identity);

  const withPostgresPermit = createRequestPostgresLimiter();
  return toSql(async <T>(text: string, params: unknown[]) =>
    withPostgresPermit(async () => {
      const client = new Client({
        connectionString: transport.connectionString,
        connectionTimeoutMillis: 10_000,
      });
      try {
        await client.connect();
        const res = await client.query(text, params);
        return res.rows as T[];
      } finally {
        await client.end().catch(() => undefined);
      }
    }),
  );
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
