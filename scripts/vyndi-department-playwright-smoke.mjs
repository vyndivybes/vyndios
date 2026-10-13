// Portable mode selector: no credentials or session material are read or logged here.
// The existing production smoke owns authenticated sign-in and exact-SHA gates.
process.env.VYNDI_TEST_DEPARTMENT_AUDIT = "1";
await import("./vyndi-production-playwright-smoke.mjs");
