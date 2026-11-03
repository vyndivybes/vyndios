import { getVyndiBridgeRoute, VYNDI_BRIDGE_EFFECT, VYNDI_BRIDGE_ROUTE_STATE } from '../../packages/contracts/vyndi-write-bridge.mjs';

function fail(code,message=code){
  const error=new Error(message);
  error.code=code;
  error.retryable=false;
  return error;
}
function required(input,key){
  const value=input?.[key];
  if(typeof value!=='string'||!value.trim()) throw fail('VYNDI_BRIDGE_INPUT_INVALID','VYNDI_BRIDGE_INPUT_INVALID:'+key);
  return value.trim();
}
function clone(value){return structuredClone(value)}
function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value)) return value;
  for(const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function prepareVyndiBridgeEnvelope(input={}){
  const actionType=required(input,'actionType');
  const employeeId=required(input,'employeeId');
  const intentId=required(input,'intentId');
  const missionId=required(input,'missionId');
  const idempotencyKey=required(input,'idempotencyKey');
  const route=getVyndiBridgeRoute(actionType);
  if(!route) throw fail('VYNDI_BRIDGE_ROUTE_NOT_FOUND');
  if(route.employeeId!==employeeId) throw fail('VYNDI_BRIDGE_EMPLOYEE_MISMATCH');
  if(route.state===VYNDI_BRIDGE_ROUTE_STATE.GAP) throw fail('VYNDI_BRIDGE_CANONICAL_AUTHORITY_GAP',route.gap||actionType);
  const approvalRef=typeof input.approvalRef==='string'&&input.approvalRef.trim()?input.approvalRef.trim():null;
  if(route.effectClass===VYNDI_BRIDGE_EFFECT.MUTATION&&!approvalRef) throw fail('VYNDI_BRIDGE_APPROVAL_REQUIRED');
  const sourceReference=`VAOS|${missionId}|${intentId}`;
  return freeze({
    contractVersion:'vyndi-write-bridge.preparation.v1',
    state:'PREPARED',
    executionEnabled:route.executionEnabled===true,
    employeeId,
    actionType,
    missionId,
    intentId,
    idempotencyKey,
    approvalRef,
    sourceReference,
    target:{
      sourceFile:route.sourceFile,
      authority:route.authority,
      verificationRefs:[...route.verificationRefs],
    },
    input:input.input&&typeof input.input==='object'&&!Array.isArray(input.input)?clone(input.input):{},
  });
}

export function createVyndiWriteBridgeAdapter({transport}={}){
  if(transport!==undefined&&typeof transport!=='function') throw fail('VYNDI_BRIDGE_TRANSPORT_INVALID');
  return Object.freeze({
    prepare:prepareVyndiBridgeEnvelope,
    async execute(envelope){
      if(!envelope||envelope.contractVersion!=='vyndi-write-bridge.preparation.v1') throw fail('VYNDI_BRIDGE_ENVELOPE_INVALID');
      const route=getVyndiBridgeRoute(envelope.actionType);
      if(!route) throw fail('VYNDI_BRIDGE_ROUTE_NOT_FOUND');
      if(!route.executionEnabled||envelope.executionEnabled!==true){
        throw fail('VYNDI_WRITE_BRIDGE_NOT_COMMISSIONED');
      }
      if(typeof transport!=='function') throw fail('VYNDI_BRIDGE_TRANSPORT_REQUIRED');
      return transport(envelope);
    },
  });
}
