const ROUTE_STATE=Object.freeze({
  READ_READY:'READ_READY',
  WRITE_PREPARED:'WRITE_PREPARED',
  GAP:'GAP',
});

const EFFECT=Object.freeze({
  READ:'read',
  MUTATION:'mutation',
});

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value)) return value;
  for(const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function route(input){
  const required=['actionType','employeeId','effectClass','state','sourceFile','authority'];
  for(const key of required){
    if(typeof input[key]!=='string'||!input[key].trim()) throw new Error('VYNDI_BRIDGE_ROUTE_INVALID:'+key);
  }
  if(!Object.values(EFFECT).includes(input.effectClass)) throw new Error('VYNDI_BRIDGE_EFFECT_INVALID');
  if(!Object.values(ROUTE_STATE).includes(input.state)) throw new Error('VYNDI_BRIDGE_STATE_INVALID');
  const executionEnabled=input.executionEnabled===true;
  if (executionEnabled && !(input.effectClass===EFFECT.READ && input.state===ROUTE_STATE.READ_READY)) {
    throw new Error('VYNDI_BRIDGE_EXECUTION_SCOPE_INVALID');
  }
  return freeze({
    ...structuredClone(input),
    executionEnabled,
    approvalRequired:input.effectClass===EFFECT.MUTATION ? input.approvalRequired!==false : false,
    verificationRefs:[...(input.verificationRefs||[])],
  });
}

export const VYNDI_BRIDGE_ROUTE_STATE=ROUTE_STATE;
export const VYNDI_BRIDGE_EFFECT=EFFECT;

export const VYNDI_BRIDGE_ROUTES=freeze([
  route({
    actionType:'PROJECT.OBSERVE_SCHEDULE',employeeId:'project',effectClass:EFFECT.READ,
    state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/vaos-schedule-export.ts',authority:'readGovernedProgramSchedule',
    verificationRefs:['vyndi_program_tasks'],
    description:'Read a minimal unapproved programme schedule; approvals remain VAOS-owned.'
  }),
  route({
    actionType:'COMMERCIAL.OBSERVE_PIPELINE',employeeId:'commercial',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/sales-order-authority.ts',authority:'listSalesOrders',
    verificationRefs:['vyndi_sales_orders'],description:'Read canonical sales-order pipeline.'
  }),
  route({
    actionType:'COMMERCIAL.COMMIT_ORDER',employeeId:'commercial',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/sales-order-authority.ts',authority:'saveSalesOrder',
    verificationRefs:['vyndi_sales_orders','vyndi_sales_order_revisions'],
    description:'Create or revise a governed sales order using VYNDI validation, revision receipt and actor authority.'
  }),
  route({
    actionType:'COMMERCIAL.CHANGE_COMMITMENT',employeeId:'commercial',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/sales-order-authority.ts',authority:'saveSalesOrder',
    verificationRefs:['vyndi_sales_orders','vyndi_sales_order_revisions'],
    description:'Controlled sales commitment revision; VYNDI blocks material changes while linked production is in progress.'
  }),

  route({
    actionType:'PROCUREMENT.OBSERVE_SHORTAGE',employeeId:'procurement',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/production-job-card.ts',authority:'getConfiguredDemandShortages',
    verificationRefs:['master_inventory_items','epr_production_job_cards'],description:'Read governed configured-demand shortages.'
  }),
  route({
    actionType:'PROCUREMENT.CREATE_PO',employeeId:'procurement',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/purchase-draft-authority.ts',authority:'submitDraftPurchaseOrder',
    verificationRefs:['vyndi_purchase_orders'],description:'Prepare a canonical draft purchase order; downstream approval remains VYNDI-owned.'
  }),
  route({
    actionType:'PROCUREMENT.CHANGE_PO',employeeId:'procurement',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/purchase-order-amendment-authority.ts',authority:'amendPurchaseOrder',
    verificationRefs:['vyndi_purchase_orders','vyndi_audit_events'],
    description:'Controlled PO amendment with optimistic revision checks; approved amendments return to pending approval.'
  }),

  route({
    actionType:'INVENTORY.OBSERVE_STOCK',employeeId:'inventory',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/inventory-authority.ts',authority:'getAuthoritativeInventory',
    verificationRefs:['vyndi_inventory_balance'],description:'Read canonical shared inventory balance.'
  }),
  route({
    actionType:'INVENTORY.RESERVE_MATERIAL',employeeId:'inventory',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/production-job-card.ts',authority:'refreshProductionReservations',
    verificationRefs:['epr_inventory_reservations','epr_production_job_cards'],
    description:'Refresh job-bound material reservations through the canonical Production/Inventory authority.'
  }),
  route({
    actionType:'INVENTORY.ISSUE_MATERIAL',employeeId:'inventory',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/production-job-card.ts',authority:'issueProductionReservation',
    verificationRefs:['epr_inventory_ledger','epr_inventory_fifo_allocations','epr_inventory_reservations'],
    description:'Issue reserved material through canonical FIFO/job trace authority.'
  }),

  route({
    actionType:'PRODUCTION.OBSERVE_WIP',employeeId:'production',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/production-job-card.ts',authority:'getProductionJobCards',
    verificationRefs:['epr_production_job_cards'],description:'Read canonical production job/WIP state.'
  }),
  route({
    actionType:'PRODUCTION.RELEASE_JOB',employeeId:'production',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/production-release-authority.ts',authority:'approveProductionBatch',
    verificationRefs:['epr_production_job_cards','epr_travellers','vyndi_purchase_orders'],
    description:'Use controlled production-batch approval with actor approval and returned release evidence.'
  }),
  route({
    actionType:'PRODUCTION.ADVANCE_STAGE',employeeId:'production',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/production-traveller-stage-authority.ts',authority:'advanceProductionTravellerStage',
    verificationRefs:['epr_travellers','epr_gate_events','vyndi_quality_inspections','vyndi_audit_events'],
    description:'Forward-only traveller progression with EPR-04, release-block and canonical Quality-release gates.'
  }),

  route({
    actionType:'MAINTENANCE.OBSERVE_ASSET',employeeId:'maintenance',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/asset-maintenance-authority.ts',authority:'getAssetMaintenanceState',
    verificationRefs:['epr_equipment','vyndi_maintenance_work_orders'],description:'Read canonical asset and maintenance state.'
  }),
  route({
    actionType:'MAINTENANCE.OPEN_WORK_ORDER',employeeId:'maintenance',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/asset-maintenance-authority.ts',authority:'createMaintenanceWorkOrder',
    verificationRefs:['vyndi_maintenance_work_orders','vyndi_audit_events'],
    description:'Open a governed maintenance work order.'
  }),
  route({
    actionType:'MAINTENANCE.RETURN_TO_SERVICE',employeeId:'maintenance',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/asset-maintenance-authority.ts',authority:'completeMaintenanceWorkOrder',
    verificationRefs:['vyndi_maintenance_work_orders','epr_equipment','vyndi_audit_events'],
    description:'Complete controlled maintenance; VYNDI release-state logic remains authoritative.'
  }),

  route({
    actionType:'FINANCE.OBSERVE_LEDGER',employeeId:'finance',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/finance/accounting-authority.ts',authority:'getAccountingWorkbench',
    verificationRefs:['epr_finance_general_ledger','epr_finance_journals'],description:'Read canonical finance workbench and ledger evidence.'
  }),
  route({
    actionType:'FINANCE.PREPARE_PAYMENT',employeeId:'finance',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/finance/payment-preparation-authority.ts',authority:'prepareSupplierPayment',
    verificationRefs:['vyndi_supplier_payment_preparations','vyndi_supplier_invoices','vyndi_audit_events'],
    description:'Maker/checker supplier-payment preparation; preparation itself posts no payment, cash movement or journal.'
  }),

  route({
    actionType:'PEOPLE.OBSERVE_WORKFORCE',employeeId:'people',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/people-office-authority.ts',authority:'listPeopleOfficeAuthority',
    verificationRefs:['vyndi_people_records'],description:'Read canonical People & Office authority state.'
  }),
  route({
    actionType:'PEOPLE.PREPARE_PAYROLL',employeeId:'people',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/people-office-authority.ts',authority:'recordPayrollReadiness',
    verificationRefs:['vyndi_people_payroll_readiness_ledger'],
    description:'Prepare People-side payroll readiness. Finance posting/payment remains a separate authority.'
  }),
  route({
    actionType:'PEOPLE.CHANGE_EMPLOYEE_MASTER',employeeId:'people',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/people-office-authority.ts',authority:'savePeopleRecordDraft',
    verificationRefs:['vyndi_people_records','vyndi_audit_events'],
    description:'Prepare controlled People master draft; approval lifecycle remains separately governed.'
  }),

  route({
    actionType:'ENGINEERING.OBSERVE_CONFIGURATION',employeeId:'engineering-configuration',effectClass:EFFECT.READ,state:ROUTE_STATE.READ_READY,executionEnabled:true,
    sourceFile:'src/lib/engineering-change-control-authority.ts',authority:'getEngineeringChangeControlState',
    verificationRefs:['vyndi_engineering_change_orders','vyndi_engineering_baselines'],
    description:'Read canonical engineering change/configuration authority state.'
  }),
  route({
    actionType:'ENGINEERING.CONFIGURATION_CHANGE',employeeId:'engineering-configuration',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/engineering-change-control-authority.ts',authority:'createEngineeringChangeOrder',
    verificationRefs:['vyndi_engineering_change_orders','vyndi_audit_events'],
    description:'Prepare controlled engineering change through canonical ECO authority.'
  }),
  route({
    actionType:'ENGINEERING.RELEASE_CONFIGURATION',employeeId:'engineering-configuration',effectClass:EFFECT.MUTATION,state:ROUTE_STATE.WRITE_PREPARED,
    sourceFile:'src/lib/engineering-change-control-authority.ts',authority:'releaseEngineeringChangeOrder',
    verificationRefs:['vyndi_engineering_change_notices','vyndi_audit_events'],
    description:'High-assurance configuration release; maker-checker and VYNDI approval remain authoritative.'
  }),
]);

const BY_ACTION=new Map(VYNDI_BRIDGE_ROUTES.map(item=>[item.actionType,item]));

export function getVyndiBridgeRoute(actionType){
  return BY_ACTION.get(actionType)||null;
}

export function getVyndiBridgeReadiness(){
  const routes=VYNDI_BRIDGE_ROUTES;
  return freeze({
    routeCount:routes.length,
    readReady:routes.filter(r=>r.state===ROUTE_STATE.READ_READY).length,
    writePrepared:routes.filter(r=>r.state===ROUTE_STATE.WRITE_PREPARED).length,
    gaps:routes.filter(r=>r.state===ROUTE_STATE.GAP).map(r=>({actionType:r.actionType,employeeId:r.employeeId,gap:r.gap})),
    executionEnabled:routes.some(r=>r.executionEnabled),
  });
}
