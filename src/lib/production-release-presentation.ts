import {isFourOrderDemoOrder} from "./four-order-demo-scope.ts";
type Card={sales_order_id:unknown;status:unknown;approved_by?:unknown;approved_at?:unknown;sales_order_revision?:unknown};
export function jobCardReleasePresentation(card:Card,currentOrderRevision:unknown){
 const isDemo=isFourOrderDemoOrder(String(card.sales_order_id||""));
 const storedStatus=String(card.status||"");
 const approver=String(card.approved_by||"");
 const approvalRecorded=!isDemo&&["released","in_progress","complete"].includes(storedStatus)&&
  !!approver&&!approver.startsWith("system:")&&!approver.startsWith("command:")&&
  !!card.approved_at&&Number.isFinite(Date.parse(String(card.approved_at)))&&
  Number.isInteger(Number(currentOrderRevision))&&Number(currentOrderRevision)>0&&
  Number(currentOrderRevision)===Number(card.sales_order_revision);
 return {isDemo,storedStatus,approvalRecorded,physicalReleaseQualified:false as const,
  label:isDemo?"DEMO / NOT A PHYSICAL RELEASE":approvalRecorded?"APPROVAL RECORDED / RELEASE GATES APPLY":"NOT RELEASED / APPROVAL UNVERIFIED"};
}
