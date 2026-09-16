/**
 * Default governed HiGHS deployment provider for Cloudflare Workers.
 *
 * Keep the WebAssembly import behind this lazily imported provider so ordinary
 * application requests do not pay solver startup cost. The Cloudflare Vite
 * adapter turns the direct .wasm import into a WebAssembly.Module.
 */
export async function createDeploymentHighsOptimizer() {
  const [{ default: highsWasm }, { createPrecompiledHighsOptimizer }] = await Promise.all([
    import("../generated/highs.wasm"),
    import("./advanced-planning-highs-runtime.ts"),
  ]);
  return createPrecompiledHighsOptimizer(highsWasm);
}
