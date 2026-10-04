import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

const [skill,project,pkg]=await Promise.all([
  read(".grok/skills/vyndi-evidence-verification/SKILL.md"),
  read("AGENTS.project.md"),
  read("package.json"),
]);

test("VYNDI verification skill defines strict evidence-backed lifecycle states",()=>{
  for (const token of [
    "CODED",
    "TESTED",
    "BUILD_GREEN",
    "SMOKE_GREEN",
    "MERGED",
    "DEPLOYED",
    "PRODUCTION_VERIFIED",
    "FAILED",
    "UNVERIFIED",
  ]) assert.match(skill,new RegExp(`\\b${token}\\b`));
});

test("completion language is forbidden without matching evidence",()=>{
  assert.match(skill,/do not say.*done|forbid.*done|never say.*done/i);
  assert.match(skill,/green.*evidence|evidence.*green/i);
  assert.match(skill,/ready.*evidence|evidence.*ready/i);
  assert.match(skill,/first blocking stage/i);
});

test("stacked PRs inherit upstream qualification failure",()=>{
  assert.match(skill,/stacked|downstream/i);
  assert.match(skill,/upstream.*fail|failed upstream|upstream failure/i);
  assert.match(skill,/unqualified|UNVERIFIED/i);
});

test("project instructions make the verification skill mandatory",()=>{
  assert.match(project,/vyndi-evidence-verification\/SKILL\.md/);
  assert.match(project,/before.*status|status.*before/i);
  assert.match(project,/before.*merge|merge.*before/i);
  assert.match(project,/before.*deploy|deploy.*before/i);
});

test("repository test suite guards the verification skill contract",()=>{
  const packageJson=JSON.parse(pkg);
  assert.match(packageJson.scripts.test,/vyndi-evidence-verification-skill\.test\.mjs/);
});
