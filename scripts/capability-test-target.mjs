const HOST = "ep-spring-hat-b49hupiw-pooler.c-6.us-east-2.aws.neon.tech";
const DATABASE = "vyndios_capability_test";
export function validateCapabilityTarget({ databaseUrl, workerName, confirmation }) {
  const reject = () => { throw new Error("Capability test target rejected"); };
  let url;
  try { url = new URL(databaseUrl); } catch { return reject(); }
  if (confirmation !== "SYNTHETIC-CAPABILITY-TEST-ONLY" ||
      workerName !== "vyndios-capability-test" ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== HOST || (url.port && url.port !== "5432") ||
      url.pathname !== "/" + DATABASE || url.hash ||
      !url.username || !url.password ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      url.searchParams.get("sslmode") !== "require" ||
      [...url.searchParams.keys()].some(key => !["sslmode", "channel_binding"].includes(key))) reject();
  return Object.freeze({ host: HOST, database: DATABASE, workerName });
}
