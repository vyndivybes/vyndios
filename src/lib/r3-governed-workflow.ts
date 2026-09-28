export type R3WorkflowStatus="draft"|"pending_approval"|"approved"|"released"|"superseded"|"rejected";
export type R3WorkflowRole="engineering"|"qa"|"compliance"|"admin"|"management"|"vibpe";
export type R3WorkflowActor={id:string;role:R3WorkflowRole};
export type R3WorkflowRecord={id:string;domain:string;status:R3WorkflowStatus;createdBy:string;submittedBy?:string;approvedBy?:string;releasedBy?:string;supersededBy?:string};
export type R3WorkflowAction="submit"|"approve"|"reject"|"release"|"supersede";
export type R3WorkflowDecision={allowed:boolean;reason:"ALLOWED"|"INVALID_TRANSITION"|"SEGREGATION_OF_DUTIES"|"HUMAN_APPROVAL_REQUIRED"|"CONFIGURATION_AUTHORITY_REQUIRED"|"SUCCESSOR_DOMAIN_MISMATCH"|"SUCCESSOR_NOT_RELEASED";record:R3WorkflowRecord};

export function createWorkflow(input:{id:string;domain:string;createdBy:string}):R3WorkflowRecord{
 return {id:input.id,domain:input.domain,createdBy:input.createdBy,status:"draft"};
}
export function transitionWorkflow(record:R3WorkflowRecord,input:{action:R3WorkflowAction;actor:R3WorkflowActor;successor?:{id:string;domain:string;status:R3WorkflowStatus}}):R3WorkflowDecision{
 if(input.actor.role==="vibpe"&&["approve","reject","release","supersede"].includes(input.action)) return {allowed:false,reason:"HUMAN_APPROVAL_REQUIRED",record};
 const fail=(reason:R3WorkflowDecision["reason"]):R3WorkflowDecision=>({allowed:false,reason,record});
 if(input.action==="submit"){
  if(record.status!=="draft") return fail("INVALID_TRANSITION");
  return {allowed:true,reason:"ALLOWED",record:{...record,status:"pending_approval",submittedBy:input.actor.id}};
 }
 if(input.action==="approve"){
  if(record.status!=="pending_approval") return fail("INVALID_TRANSITION");
  if(input.actor.id===record.createdBy||input.actor.id===record.submittedBy) return fail("SEGREGATION_OF_DUTIES");
  if(!["qa","compliance","admin"].includes(input.actor.role)) return fail("CONFIGURATION_AUTHORITY_REQUIRED");
  return {allowed:true,reason:"ALLOWED",record:{...record,status:"approved",approvedBy:input.actor.id}};
 }
 if(input.action==="reject"){
  if(record.status!=="pending_approval") return fail("INVALID_TRANSITION");
  if(input.actor.id===record.createdBy||input.actor.id===record.submittedBy) return fail("SEGREGATION_OF_DUTIES");
  return {allowed:true,reason:"ALLOWED",record:{...record,status:"rejected",approvedBy:input.actor.id}};
 }
 if(input.action==="release"){
  if(record.status!=="approved") return fail("INVALID_TRANSITION");
  if(input.actor.role!=="admin") return fail("CONFIGURATION_AUTHORITY_REQUIRED");
  if(input.actor.id===record.createdBy||input.actor.id===record.submittedBy||input.actor.id===record.approvedBy) return fail("SEGREGATION_OF_DUTIES");
  return {allowed:true,reason:"ALLOWED",record:{...record,status:"released",releasedBy:input.actor.id}};
 }
 if(record.status!=="released") return fail("INVALID_TRANSITION");
 if(input.actor.role!=="admin") return fail("CONFIGURATION_AUTHORITY_REQUIRED");
 if(!input.successor||input.successor.status!=="released") return fail("SUCCESSOR_NOT_RELEASED");
 if(input.successor.domain!==record.domain) return fail("SUCCESSOR_DOMAIN_MISMATCH");
 return {allowed:true,reason:"ALLOWED",record:{...record,status:"superseded",supersededBy:input.actor.id}};
}

export function evaluateWaiver(input:{gateId:string;criticality:"normal"|"safety_critical";reason:string;requestedBy:string;approvedBy:string;expiresOn:string},asOfDate:string){
 if(input.criticality==="safety_critical") return {allowed:false,reason:"SAFETY_CRITICAL_GATE_NOT_WAIVABLE" as const};
 if(!input.reason.trim()||input.requestedBy===input.approvedBy) return {allowed:false,reason:"INVALID_WAIVER_GOVERNANCE" as const};
 if(Date.parse(input.expiresOn+"T00:00:00Z")<Date.parse(asOfDate+"T00:00:00Z")) return {allowed:false,reason:"WAIVER_EXPIRED" as const};
 return {allowed:true,reason:"ALLOWED" as const};
}
