import type { IbpeScenarioRequest } from "@/lib/ibpe-scenario-lab";

export type VibpeIntent =
  | "conversation"
  | "baseline"
  | "planning-horizon"
  | "scenario"
  | "comparison"
  | "optimisation"
  | "root-cause"
  | "guided-work"
  | "control-tower"
  | "demand"
  | "materials"
  | "procurement"
  | "capacity"
  | "funding"
  | "follow-up"
  | "navigation"
  | "assessment";

export type VibpeScenarioParse = {
  intent: VibpeIntent;
  horizonMonths?: number;
  scenario?: IbpeScenarioRequest;
  scenarioPatch?: Partial<IbpeScenarioRequest>;
  fundingDelayMonths?: number;
  resetScenario?: boolean;
  referencedProducts: string[];
  preservePriorScenario: boolean;
  conversationalReply?: string;
};

const BASE_SCENARIO: Omit<IbpeScenarioRequest, "id" | "label"> = {
  demandMultiplier: 1,
  capacityMultiplier: 1,
  procurementCostMultiplier: 1,
  leadTimeMultiplier: 1,
  receiptDelayMonths: 0,
  cashInjectionLakh: 0,
  cashInjectionPeriod: 6,
};

const PRODUCT_MAP: Array<[RegExp, string, string]> = [
  [/\blongitude\b/i, "aluminium", "Longitude"],
  [/\blatitude\b/i, "carbon", "Latitude"],
  [/\baltitude\b/i, "premiumCarbon", "Altitude"],
];

function normalise(value: string) {
  return value.replace(/[₹,]/g, "").replace(/\s+/g, " ").trim();
}

function numberFrom(match: RegExpMatchArray | null) {
  if (!match?.[1]) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

function horizonFromQuestion(question: string) {
  const q = normalise(question.toLowerCase());
  return (
    numberFrom(q.match(/(?:next|coming|plan(?:ning)?(?:\s+for)?|forecast(?:\s+for)?|horizon(?:\s+of)?)\s+(\d{1,2})\s*months?/i)) ??
    numberFrom(q.match(/(\d{1,2})\s*month\s+(?:plan|planning|forecast|horizon)/i))
  );
}

function cashInjectionFromQuestion(question: string) {
  const q = normalise(question.toLowerCase());
  const patterns = [
    /(?:inject|injection|add|additional|extra|fund|funding|finance|capital|cash)\D{0,18}(\d+(?:\.\d+)?)\s*(?:l|lac|lakh|lakhs)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:l|lac|lakh|lakhs)\D{0,18}(?:fund|funding|finance|capital|cash|inject|injection)/i,
  ];
  for (const pattern of patterns) {
    const amount = numberFrom(q.match(pattern));
    if (amount != null) return amount;
  }
  return undefined;
}

function percentFrom(question: string, terms: RegExp) {
  // Split independent changes so a cost percentage cannot become a demand change.
  const clauses = normalise(question.toLowerCase()).split(/;|\band\b|\bthen\b|\balso\b/);
  for (const clause of clauses) {
    if (!terms.test(clause)) continue;
    const matches = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
    if (matches.length === 1) return Number(matches[0][1]);
  }
  return undefined;
}

function delayFromQuestion(question: string) {
  const q = normalise(question.toLowerCase());
  return numberFrom(q.match(/(?:delay|defer|push|postpone)[^.;]{0,24}(\d{1,2})\s*months?/i));
}

function detectConversation(question: string) {
  const q = question.toLowerCase().trim().replace(/[!?.,]+$/g, "").trim();
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)$/.test(q)) {
    return "Hi. VIBPE Co-Pilot is online. Ask about demand, materials, procurement, capacity, cash, funding, or a scenario.";
  }
  if (/^(bye|goodbye|see you|thanks|thank you|ok thanks|okay thanks)$/.test(q)) {
    return /thank/.test(q) ? "You’re welcome." : "Goodbye.";
  }
  return undefined;
}

export function parseVibpeIntent(question: string): VibpeScenarioParse {
  const q = question.toLowerCase();
  const conversationalReply = detectConversation(question);
  if (conversationalReply) {
    return { intent: "conversation", referencedProducts: [], preservePriorScenario: false, conversationalReply };
  }

  const referenced = PRODUCT_MAP.filter(([pattern]) => pattern.test(question));
  const referencedProducts = referenced.map(([, productId]) => productId);
  const horizonMonths = horizonFromQuestion(question);
  const cashInjectionLakh = cashInjectionFromQuestion(question);
  const demandPct = percentFrom(question, /(?:demand|sales|volume|units|growth)/);
  const costPct = percentFrom(question, /(?:procurement|purchase|supplier|material|component|cost|price)/);
  const capacityPct = percentFrom(question, /(?:capacity|production|manufacturing|output)/);
  const leadTimePct = percentFrom(question, /(?:lead\s*time|supplier\s*time)/);
  const delayMonths = delayFromQuestion(question);
  const fundingDelayMonths = /fund|capital|cash injection/i.test(q)
    ? delayMonths ?? numberFrom(normalise(q).match(/(?:funding|capital|cash injection)[^.;]{0,30}(\d{1,2})\s*months?\s+(?:late|later)/i))
    : undefined;
  const resetScenario = /\b(?:reset|clear) (?:the )?scenario\b|\b(?:new scenario|from baseline|back to (?:the )?baseline)\b|^(?:show (?:the )?)?(?:governed |approved )?baseline[?.!\s]*$/i.test(question);

  const decreases = (terms: RegExp) => normalise(q).split(/;|\band\b|\bthen\b|\balso\b/)
    .some((clause) => terms.test(clause) && /\b(reduce|decrease|cut|lower|slow)\b/.test(clause));
  const asksDecreaseDemand = decreases(/demand|sales|volume|units/);
  const asksDecreaseCost = decreases(/cost|price|procurement|purchase|supplier|material|component/);

  const patch: Partial<IbpeScenarioRequest> = {};
  if (cashInjectionLakh != null) {
    patch.cashInjectionLakh = cashInjectionLakh;
    patch.cashInjectionPeriod = numberFrom(normalise(q).match(/(?:in|at|by)\s+(?:month\s*|m)(\d{1,2})\b/i)) ?? 1;
  }
  if (demandPct != null && /demand|sales|volume|units|growth/i.test(q)) {
    const multiplier = 1 + (asksDecreaseDemand ? -demandPct : demandPct) / 100;
    if (referenced.length === 1) patch.demandMultiplierByProduct = { [referenced[0][1]]: multiplier };
    else patch.demandMultiplier = multiplier;
  }
  if (costPct != null && /cost|price|procurement|purchase|supplier|material|component/i.test(q)) {
    patch.procurementCostMultiplier = 1 + (asksDecreaseCost ? -costPct : costPct) / 100;
  }
  if (capacityPct != null && /capacity|production|manufacturing|output/i.test(q)) {
    const decrease = decreases(/capacity|production|manufacturing|output/);
    patch.capacityMultiplier = 1 + (decrease ? -capacityPct : capacityPct) / 100;
  }
  if (leadTimePct != null && /lead\s*time|supplier\s*time/i.test(q)) {
    const decrease = decreases(/lead\s*time|supplier\s*time/);
    patch.leadTimeMultiplier = 1 + (decrease ? -leadTimePct : leadTimePct) / 100;
  }
  if (delayMonths != null && /receipt|supply|supplier|delivery/i.test(q)) patch.receiptDelayMonths = delayMonths;

  const scenarioRequested = Object.keys(patch).length > 0;
  const isFollowUp = /^(next what|then what|what next|why|why so|compare that|and then|what about that)[?!.\s]*$/i.test(question.trim());
  const asksCompare = /\bcompare|versus|\bvs\b|which (?:is|option)|better option|safer option/i.test(q);
  const asksActualVsPlan =
    /\b(actual|actuals|transaction-derived|transaction derived|posted|reconciled)\b/i.test(q)
    && /\b(plan|planned|forecast|variance|reconcile|reconciliation)\b/i.test(q);
  const asksOptimise = /optimise|optimize|best (?:way|option|plan)|minimi[sz]e|reduce funding|lowest funding|fastest viable|safest plan/i.test(q);
  const asksGuidedWork = /guide me through|next governed step|current [^.?!]{0,50} workflow|what still requires explicit human authority|work mode|learn mode/i.test(q);
  const asksControlTower = /control\s+tower/i.test(q) && /blocker|blocked|owner|workspace|next action|cross-functional|status/i.test(q);
  const asksRootCause = /\bwhy\b|root cause|driver|caus(?:e|ed)|what is causing/i.test(q);
  const asksNavigation = /take me to|open (?:the )?(?:page|workspace)|navigate to|go to (?:the )?/i.test(q);

  let intent: VibpeIntent = "assessment";
  if (isFollowUp) intent = asksCompare ? "comparison" : "follow-up";
  else if (asksNavigation) intent = "navigation";
  else if (asksGuidedWork) intent = "guided-work";
  else if (asksControlTower) intent = "control-tower";
  else if (asksActualVsPlan) intent = "assessment";
  else if (asksCompare) intent = "comparison";
  else if (asksOptimise) intent = "optimisation";
  else if (scenarioRequested || fundingDelayMonths != null) intent = "scenario";
  else if (horizonMonths != null || /how to plan|plan for the next|forecast the next/i.test(q)) intent = "planning-horizon";
  else if (asksRootCause) intent = "root-cause";
  else if (/fund|cash|liquid|runway|budget|money/i.test(q)) intent = "funding";
  else if (/procure|purchase|supplier|buy|po\b/i.test(q)) intent = "procurement";
  else if (/material|bom|inventory|stock|shortage|atp|msl/i.test(q)) intent = "materials";
  else if (/capacity|production|manufactur|work centre|work center/i.test(q)) intent = "capacity";
  else if (/demand|sales|forecast|orders?|volume|units/i.test(q)) intent = "demand";
  else if (/baseline|governed plan|approved plan|base case/i.test(q)) intent = "baseline";

  const scenario = scenarioRequested
    ? {
        ...BASE_SCENARIO,
        ...patch,
        id: `advisory-${Date.now()}`,
        label: buildScenarioLabel({ cashInjectionLakh, demandPct, costPct, capacityPct, leadTimePct, delayMonths, referenced }),
      }
    : undefined;

  return {
    intent,
    horizonMonths,
    scenario,
    scenarioPatch: scenarioRequested ? patch : undefined,
    fundingDelayMonths,
    resetScenario,
    referencedProducts,
    preservePriorScenario: intent === "follow-up" || intent === "comparison",
  };
}

function buildScenarioLabel(input: {
  cashInjectionLakh?: number;
  demandPct?: number;
  costPct?: number;
  capacityPct?: number;
  leadTimePct?: number;
  delayMonths?: number;
  referenced: Array<[RegExp, string, string]>;
}) {
  const parts: string[] = [];
  if (input.cashInjectionLakh != null) parts.push(`Funding +₹${input.cashInjectionLakh}L`);
  if (input.demandPct != null) parts.push(`${input.referenced[0]?.[2] ? `${input.referenced[0][2]} ` : ""}demand ${input.demandPct}%`);
  if (input.costPct != null) parts.push(`procurement cost ${input.costPct}%`);
  if (input.capacityPct != null) parts.push(`capacity ${input.capacityPct}%`);
  if (input.leadTimePct != null) parts.push(`lead time ${input.leadTimePct}%`);
  if (input.delayMonths != null) parts.push(`delay ${input.delayMonths}m`);
  return parts.join(" · ") || "Advisory scenario";
}

/** Keep hypothetical and conversational requests out of exact-ledger fallback handlers. */
export function isVibpeContextualRequest(question: string): boolean {
  const parsed = parseVibpeIntent(question);
  return Boolean(parsed.scenario || parsed.fundingDelayMonths != null || parsed.resetScenario || ["follow-up", "planning-horizon", "conversation", "comparison", "guided-work"].includes(parsed.intent));
}
