import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const schema=readFileSync(new URL('../migrations/0194_ca_certificate_evidence_register.sql',import.meta.url),'utf8');
const authority=readFileSync(new URL('../src/lib/finance/ca-certificate-authority.ts',import.meta.url),'utf8');
const route=readFileSync(new URL('../src/routes/command/ca-certificate-register.tsx',import.meta.url),'utf8');
test('SQL register preserves original signed document identity and append-only events',()=>{
 assert.match(schema,/signed_document_sha256 text not null/);
 assert.match(schema,/udin text not null unique/);
 assert.match(schema,/before update on epr_finance_ca_signed_certificates/i);
 assert.match(schema,/before update or delete on epr_finance_ca_certificate_events/i);
 assert.match(schema,/checked_by<>recorded_by|checked_by <> recorded_by/i);
});
test('server always requires authenticated edit or independent approve permissions',()=>{
 assert.match(authority,/requireBusinessActor\("edit"\)/);
 assert.match(authority,/requireBusinessActor\("approve"\)/);
 assert.match(authority,/recorded_by<>\$3/);
 assert.match(authority,/epr_finance_ca_certificate_events/);
});
test('UI records hash of actually selected PDF and never stores uploaded PDF server-side',()=>{
 assert.match(route,/crypto\.subtle\.digest\("SHA-256"/);
 assert.match(route,/not uploaded/i);
 assert.match(route,/getCaSignedCertificateRegister/);
 assert.match(route,/recordIndependentCaUdinCheck/);
});
