export type DecisionClass =
  | "evidence_closure"
  | "risk_reduction"
  | "supply_resilience"
  | "quality_evidence"
  | "schedule_protection"
  | "maintain_baseline";

export type DecisionOption = {
  id:string;
  decisionClass:DecisionClass;
  title:string;
  rationale:string;
  actions:string[];
  consequences:string[];
  evidenceReferences:string[];
  authorityRequired:string;
  quantifiedBenefit:null;
  priority:number;
  status:"advisory";
};

export type DecisionIntelligenceInput={
  readiness:{
    taskReadinessPct:number|null;
    evidenceCompletenessPct:number|null;
    evidenceConfidencePct:number|null;
    configurationBlockers:number;
    activeRiskCount:number;
    highestRiskExposureScore:number|null;
  };
  risks:Array<{
    id:string;
    domain:string;
    exposureScore:number|null;
    title:string;
    sourceReference:string|null;
  }>;
  monteCarlo:{
    available:boolean;
    p50Days:number|null;
    p80Days:number|null;
    p95Days:number|null;
    sourceReference:string|null;
  };
  supplier:{
    singleSourceSkuCount:number;
    singleSourceSkus:string[];
    sourceReference:string|null;
  };
  quality:{
    openCriticalNcr:number;
    openMajorNcr:number;
    capabilityGapCount:number;
    sourceReference:string|null;
  };
};

const compact=(items:Array<string|null|undefined>)=>[...new Set(items.filter((x):x is string=>Boolean(x&&x.trim())))];

export function buildDecisionIntelligence(input:DecisionIntelligenceInput){
  const options:DecisionOption[]=[];

  const evidenceIncomplete=input.readiness.evidenceCompletenessPct!=null
    ? input.readiness.evidenceCompletenessPct<100
    : false;
  if(input.readiness.configurationBlockers>0||evidenceIncomplete){
    options.push({
      id:"DECISION-EVIDENCE-CLOSURE",
      decisionClass:"evidence_closure",
      title:"Close configuration and release-evidence blockers before commitment",
      rationale:[
        input.readiness.configurationBlockers>0
          ? `${input.readiness.configurationBlockers} configuration blocker(s) remain active.`
          : null,
        input.readiness.evidenceCompletenessPct!=null
          ? `Required evidence completeness is ${input.readiness.evidenceCompletenessPct}%.`
          : null,
      ].filter(Boolean).join(" "),
      actions:[
        "Resolve the highest-authority configuration conflict first.",
        "Close or disposition required evidence gaps through the owning VEDM/Engineering authority.",
        "Re-run readiness, risk and release checks after the evidence state changes.",
      ],
      consequences:[
        "Protects release authority from using stale, incomplete or conflicting evidence.",
        "May defer downstream commitment until the affected authority chain is reconciled.",
      ],
      evidenceReferences:compact(input.risks.map((r)=>r.sourceReference)),
      authorityRequired:"Human Engineering / Configuration Authority approval remains mandatory.",
      quantifiedBenefit:null,
      priority:10,
      status:"advisory",
    });
  }

  const highest=[...input.risks]
    .filter((risk)=>risk.exposureScore!=null)
    .sort((a,b)=>(b.exposureScore??-1)-(a.exposureScore??-1)||a.id.localeCompare(b.id))[0];
  if(highest&&(highest.exposureScore??0)>=6){
    options.push({
      id:"DECISION-RISK-REDUCTION",
      decisionClass:"risk_reduction",
      title:`Mitigate the highest governed risk: ${highest.id}`,
      rationale:`${highest.title} carries governed exposure ${highest.exposureScore}/9 in ${highest.domain}.`,
      actions:[
        "Execute the recorded mitigation through the owning authority.",
        "Update evidence and re-assess exposure after mitigation evidence exists.",
        "Do not close or accept the risk automatically from this recommendation.",
      ],
      consequences:[
        "Reduces the most highly exposed governed risk before additional commitment.",
        "Schedule/cost benefit is not quantified unless a governed scenario or forecast explicitly measures it.",
      ],
      evidenceReferences:compact([highest.sourceReference]),
      authorityRequired:"Human risk owner and applicable approval authority must accept, mitigate or close the risk.",
      quantifiedBenefit:null,
      priority:20,
      status:"advisory",
    });
  }

  if(input.supplier.singleSourceSkuCount>0){
    options.push({
      id:"DECISION-SUPPLY-RESILIENCE",
      decisionClass:"supply_resilience",
      title:"Reduce single-source exposure on governed supplier lanes",
      rationale:`${input.supplier.singleSourceSkuCount} SKU(s) currently have only one effective approved supplier lane.`,
      actions:[
        "Qualify an alternate supplier lane where technically and commercially appropriate.",
        "Preserve current approved supplier authority until the alternate source is independently qualified.",
        "Use PO/GRN performance evidence to compare delivery and incoming-quality outcomes after qualification.",
      ],
      consequences:[
        `Affected SKU(s): ${input.supplier.singleSourceSkus.join(", ") || "not enumerated in captured evidence"}.`,
        "Single-source exposure is a configuration fact; no disruption probability is inferred.",
      ],
      evidenceReferences:compact([input.supplier.sourceReference]),
      authorityRequired:"Procurement and applicable Engineering/Quality approval remains human-controlled.",
      quantifiedBenefit:null,
      priority:30,
      status:"advisory",
    });
  }

  if(input.quality.openCriticalNcr>0||input.quality.openMajorNcr>0||input.quality.capabilityGapCount>0){
    options.push({
      id:"DECISION-QUALITY-EVIDENCE",
      decisionClass:"quality_evidence",
      title:"Close quality-control and capability evidence gaps before scaling",
      rationale:`${input.quality.openCriticalNcr} critical NCR(s), ${input.quality.openMajorNcr} major NCR(s), and ${input.quality.capabilityGapCount} capability evidence gap(s) remain.`,
      actions:[
        "Close blocking NCR/CAPA chains with verified evidence.",
        "Collect sufficient controlled measurements before publishing Cp/Cpk.",
        "Re-capture Manufacturing & Quality Intelligence after evidence closure.",
      ],
      consequences:[
        "Prevents weak sample evidence from being presented as production capability.",
        "No future defect-rate reduction is claimed until empirical evidence supports it.",
      ],
      evidenceReferences:compact([input.quality.sourceReference]),
      authorityRequired:"Quality authority controls NCR/CAPA disposition and release decisions.",
      quantifiedBenefit:null,
      priority:40,
      status:"advisory",
    });
  }

  if(
    input.monteCarlo.available&&
    input.monteCarlo.p50Days!=null&&
    input.monteCarlo.p95Days!=null&&
    input.monteCarlo.p95Days>input.monteCarlo.p50Days
  ){
    options.push({
      id:"DECISION-SCHEDULE-PROTECTION",
      decisionClass:"schedule_protection",
      title:"Protect the program against schedule tail risk",
      rationale:"Captured Monte Carlo evidence shows material separation between median and high-confidence completion horizons.",
      actions:[
        "Review tasks that dominate sampled critical-path frequency.",
        "Prioritize evidence closure, resource or supplier actions only where the governed critical-path model shows linkage.",
        "Run a controlled scenario before changing the approved plan.",
      ],
      consequences:[
        `Captured schedule evidence: P50 ${input.monteCarlo.p50Days} d · P80 ${input.monteCarlo.p80Days ?? "—"} d · P95 ${input.monteCarlo.p95Days} d.`,
        "The recommendation does not convert planning quantiles into a promised completion date.",
      ],
      evidenceReferences:compact([input.monteCarlo.sourceReference]),
      authorityRequired:"Program owner must approve any schedule/resource change; VIBPE remains advisory.",
      quantifiedBenefit:null,
      priority:50,
      status:"advisory",
    });
  }

  options.push({
    id:"DECISION-MAINTAIN-BASELINE",
    decisionClass:"maintain_baseline",
    title:"Maintain the current governed baseline",
    rationale:options.length
      ? "This is the conservative comparison option against the active recovery/resilience choices."
      : "No evidence-backed blocker currently creates a stronger deterministic recommendation.",
    actions:[
      "Keep the current governed plan/configuration unchanged.",
      "Continue monitoring readiness, risk, supplier, quality and forecast evidence.",
      "Escalate only when controlled evidence changes the decision state.",
    ],
    consequences:[
      "Lowest change exposure.",
      "Existing unresolved risks or delays, if any, remain unless separately mitigated.",
    ],
    evidenceReferences:[],
    authorityRequired:"Human owner retains decision authority; no automatic approval or transaction occurs.",
    quantifiedBenefit:null,
    priority:90,
    status:"advisory",
  });

  options.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  return {
    generatedAt:new Date().toISOString(),
    rankingMethod:"GOVERNANCE_PRIORITY_NOT_UTILITY_OPTIMIZATION" as const,
    primaryAdvisoryOptionId:options[0]?.id??null,
    options,
    boundaries:[
      "Options are ranked by governance priority, not by an invented utility score.",
      "No option is an approval, commitment, engineering release, purchase order, funding decision or risk acceptance.",
      "Quantified benefit is withheld unless a governed scenario/forecast directly measures the consequence.",
      "Human authority remains mandatory for every controlled action.",
    ],
  };
}
