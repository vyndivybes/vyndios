import type { Sql } from "@/lib/db";
import { WEEKLY_REVIEW_SOURCE_ID } from "@/lib/vibpe-weekly-review-knowledge";
import { VAYU_SHASTR_SOURCE_ID } from "@/lib/vibpe-vayu-shastr-drive";
import {
  VIBPE_REPOSITORY_KNOWLEDGE,
  repositoryKnowledgeUrl,
} from "@/lib/vibpe-repository-knowledge";

export type VibpeKnowledgeAuthority = "controlled-reference" | "advisory" | "unresolved";

export type VibpeKnowledgeEvidence = {
  claimText: string;
  claimClass: string;
  authority: VibpeKnowledgeAuthority;
  domain: string;
  title: string;
  reviewDate: string | null;
  externalUrl: string | null;
  sourceRevision: string | null;
  documentId: string;
  sourceLocator: string | null;
  sourceId: string;
  sourcePath: string | null;
  knowledgeTier: string | null;
  sourceRepository: string | null;
  sourceCommit: string | null;
  sourceKind: "drive" | "repository-snapshot";
};

type EvidenceRow = {
  claim_text: string;
  claim_class: string;
  authority: "advisory" | "unresolved";
  domain: string;
  title: string;
  review_date: string | null;
  external_url: string | null;
  source_revision: string | null;
  document_id: string;
  source_locator: string | null;
  source_id: string;
  source_path: string | null;
  knowledge_tier: string | null;
};

const STOP_WORDS = new Set([
  "about","after","again","against","also","and","are","been","before","being","between",
  "can","could","does","from","have","into","just","more","most","not","now","our","should",
  "status","than","that","the","their","then","there","these","they","this","those","through",
  "under","very","was","were","what","when","where","which","while","with","would","your","vibpe",
]);

export function knowledgeTokens(question: string) {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9×.+-]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )].slice(0, 18);
}

function domainBonus(question: string, domain: string) {
  const q = question.toLowerCase();
  const matches: Record<string, RegExp> = {
    engineering: /design|engineering|geometry|clearance|frame|fork|cad|fea|cfd|layup|laminate|carbon|prepreg|toray|tsai|hashin|vvuq/,
    manufacturing: /prototype|manufactur|oem|tooling|laminate|supplier|drape|ndt/,
    incubation: /incubat|tansam|tancam/,
    launch: /launch|readiness|market|release/,
    operations: /vibpe|ibpe|erp|system|workflow|deployment|production|procurement|inventory|fifo|msl/,
    optimization: /optimi[sz]|highs|milp|advanced planning|solver|packet|objective|constraint/,
    finance: /finance|account|ledger|trial balance|profit|loss|cash flow|fund flow|gst|itc|bank|period close|cost accounting/,
    governance: /govern|authority|control|approval|assurance|audit|release|lineage|freeze|sod|iam/,
    venture: /venture|company|overall|weekly|progress|milestone/,
  };
  return matches[domain]?.test(q) ? 4 : 0;
}

export function scoreKnowledgeEvidence(question: string, evidence: VibpeKnowledgeEvidence) {
  const tokens = knowledgeTokens(question);
  const haystack = [
    evidence.claimText,
    evidence.domain,
    evidence.title,
    evidence.sourceLocator ?? "",
    evidence.sourcePath ?? "",
    evidence.sourceRepository ?? "",
    evidence.sourceRevision ?? "",
  ].join(" ").toLowerCase();

  let score = domainBonus(question, evidence.domain);
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 7 ? 3 : 2;
  }

  if (evidence.claimClass === "decision" || evidence.claimClass === "material_change") score += 1.25;
  if (evidence.knowledgeTier === "controlled-reference" || evidence.knowledgeTier === "controlled-repository") score += 3;
  if (evidence.knowledgeTier === "current-operational") score += 3.5;
  if (evidence.knowledgeTier === "development-reference") score += 0.5;
  if (evidence.knowledgeTier === "legacy-working") score -= 1.5;
  if (evidence.claimClass === "priority" || evidence.claimClass === "blocker") score += 0.75;
  if (evidence.authority === "controlled-reference") score += 2.5;
  if (evidence.authority === "unresolved") score -= 0.5;
  if (evidence.sourceKind === "repository-snapshot") score += 0.25;

  if (evidence.reviewDate) {
    const parsed = Date.parse(evidence.reviewDate + "T00:00:00Z");
    if (Number.isFinite(parsed)) {
      const ageDays = Math.max(0, (Date.now() - parsed) / 86400000);
      score += Math.max(0, 3 - ageDays / 30);
    }
  }
  return score;
}

function repositoryEvidence(): VibpeKnowledgeEvidence[] {
  return VIBPE_REPOSITORY_KNOWLEDGE.map((record) => ({
    claimText: record.claimText,
    claimClass: record.claimClass,
    authority: record.authority,
    domain: record.domain,
    title: record.title,
    reviewDate: record.sourceDate,
    externalUrl: repositoryKnowledgeUrl(record),
    sourceRevision: record.sourceRevision,
    documentId: record.id,
    sourceLocator: `${record.repository}@${record.sourceCommit.slice(0, 12)}`,
    sourceId: `github:${record.repository}`,
    sourcePath: record.sourcePath,
    knowledgeTier: record.knowledgeTier,
    sourceRepository: record.repository,
    sourceCommit: record.sourceCommit,
    sourceKind: "repository-snapshot",
  }));
}

export async function retrieveVibpeKnowledgeEvidence(
  sql: Sql,
  question: string,
  limit = 10,
): Promise<VibpeKnowledgeEvidence[]> {
  const rows = await sql<EvidenceRow>`
    select
      c.claim_text,
      c.claim_class,
      c.authority,
      c.domain,
      d.title,
      d.review_date::text,
      d.external_url,
      d.source_revision,
      d.id as document_id,
      c.source_locator,
      d.source_id,
      d.metadata_json->>'path' as source_path,
      d.metadata_json->>'knowledgeTier' as knowledge_tier
    from vibpe_knowledge_claims c
    join vibpe_knowledge_documents d on d.id = c.document_id
    where d.source_id in (${WEEKLY_REVIEW_SOURCE_ID}, ${VAYU_SHASTR_SOURCE_ID})
      and d.superseded_at is null
      and c.authority in ('advisory','unresolved')
    order by d.review_date desc nulls last, d.ingested_at desc, c.created_at desc
    limit 160
  `;

  const driveEvidence: VibpeKnowledgeEvidence[] = rows.map((row) => ({
    claimText: row.claim_text,
    claimClass: row.claim_class,
    authority: row.authority,
    domain: row.domain,
    title: row.title,
    reviewDate: row.review_date,
    externalUrl: row.external_url,
    sourceRevision: row.source_revision,
    documentId: row.document_id,
    sourceLocator: row.source_locator,
    sourceId: row.source_id,
    sourcePath: row.source_path,
    knowledgeTier: row.knowledge_tier,
    sourceRepository: null,
    sourceCommit: null,
    sourceKind: "drive",
  }));

  const combined = [...repositoryEvidence(), ...driveEvidence];
  const seen = new Set<string>();

  return combined
    .map((evidence) => ({ evidence, score: scoreKnowledgeEvidence(question, evidence) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .filter(({ evidence }) => {
      const key = `${evidence.claimText}|${evidence.sourcePath ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ evidence }) => evidence);
}
