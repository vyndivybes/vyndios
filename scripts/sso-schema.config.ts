/**
 * Isolated, NO-DATABASE-CONNECTION schema-generation fixture.
 * Never imported by the deployed app. Better Auth CLI must generate the
 * official PostgreSQL migration using precisely the commissioned issuer
 * plugin without ever accessing the production database or credentials.
 */
import { betterAuth } from "better-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import { PostgresDialect } from "kysely";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { founderOidcProviderOptions } from "../src/lib/auth/founder-oidc-provider.mjs";

if(process.env.SSO_FIXTURE_DATABASE_URL &&
 !/^postgresql:\/\/schema_fixture:schema_fixture@127\.0\.0\.1:54329\/schema_fixture$/.test(process.env.SSO_FIXTURE_DATABASE_URL))
 throw Error("SSO_FIXTURE_LOCAL_ONLY");
const pool=new pg.Pool({
 connectionString:process.env.SSO_FIXTURE_DATABASE_URL??"postgresql://schema_fixture:schema_fixture@127.0.0.1:1/nonexistent",
 max:1,
 connectionTimeoutMillis:500,
});
const config=founderOidcProviderOptions({VYNDI_SSO_PROVIDER_ENABLED:"commissioned-v1"});
if(!config)throw Error("OIDC_SCHEMA_FIXTURE_MISSING_PROVIDER");
export const auth=betterAuth({
 secret:randomBytes(32).toString("hex"),
 baseURL:"http://localhost:8080",
 database:{dialect:new PostgresDialect({pool}),type:"postgres"},
 disabledPaths:["/token"],
 plugins:[jwt({disableSettingJwtHeader:true}),oauthProvider(config)],
});
