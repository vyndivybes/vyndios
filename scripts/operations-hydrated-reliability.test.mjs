import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("Operations initial SSR stays a lightweight loading shell and retains canonical warnings after hydration", () => {
  const code = read("src/routes/command/operations.tsx");
  assert.match(code,/function Operations\(\)/);
  assert.match(code,/function OperationsReady\(\)/);
  assert.match(code,/useEffect\(\(\) => \{ setHydrated\(true\); \}, \[\]\)/);
  assert.match(code,/data-route-readiness="loading"/);
  assert.match(code,/data-route-readiness="ready"/);
  assert.match(code,/data-route-readiness="error"/);
  assert.match(code,/getInventoryMslWarnings\(\)/);
  assert.match(code,/warningsError/);
  assert.match(code,/listDispatchRegister\(\)/);
  assert.match(code,/listQualityAuthority\(\)/);
  assert.match(code,/getOperatingLineage\(\)/);
  assert.match(code,/allocateDispatchSerial/);
  assert.match(code,/deallocateDispatchSerial/);
});
test("SLO and authenticated smoke require hydrated actual Operations readback",()=>{
  for (const path of ["scripts/vyndi-production-playwright-smoke.mjs","scripts/vyndi-observability-slo.mjs"]) {
    const code=read(path);
    const set=code.slice(code.indexOf("const cpuBoundClientRoutes = new Set("),code.indexOf("const protectedRoutes = ["));
    assert.match(set,/\"\/command\/operations\"/);
    assert.match(code,/data-route-readiness="ready"/);
  }
});
