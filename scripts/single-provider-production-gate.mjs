import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const repositoryRoot = process.cwd();
const forbidden = ["vercel", "supabase", "netlify"];
const scanRoots = ["src", "scripts", "server", "migrations", ".github", "public"];
const rootFiles = [
  "package.json",
  "vite.config.ts",
  "wrangler.jsonc",
  "eslint.config.mjs",
  "AGENTS.md",
  "SECURITY.md",
  ".grok/references/deploy-target.md",
  "docs/VYNDI-OS-AUDIT-CLOSURE-2026-09-24.md",
];
const textExtensions = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".jsonc",
  ".sql", ".yml", ".yaml", ".md", ".html", ".css", ".txt",
]);
const self = "scripts/single-provider-production-gate.mjs";

function collect(path) {
  if (!existsSync(path)) return [];
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const childStats = statSync(child);
    if (childStats.isDirectory()) files.push(...collect(child));
    else if (textExtensions.has(extname(child).toLowerCase())) files.push(child);
  }
  return files;
}

const files = [
  ...scanRoots.flatMap((root) => collect(join(repositoryRoot, root))),
  ...rootFiles.map((file) => join(repositoryRoot, file)).filter(existsSync),
];

const findings = [];
for (const file of files) {
  const rel = relative(repositoryRoot, file).replaceAll("\\", "/");
  if (rel === self || rel === "package-lock.json") continue;
  const content = readFileSync(file, "utf8").toLowerCase();
  for (const provider of forbidden) {
    if (content.includes(provider)) findings.push({ file: rel, provider });
  }
}

if (findings.length) {
  console.error("Single-provider production gate FAILED.");
  for (const finding of findings) console.error(`- ${finding.file}: retired provider reference ${finding.provider}`);
  process.exit(1);
}

console.log("Single-provider production gate PASS: Cloudflare-only active source/config.");
