import {assertPhysicalProductionOrder} from "./four-order-demo-scope.ts";
type Reader={query<T>(text:string,params?:unknown[]):Promise<T[]>};
/** Read-only guard before any physical side effect; historical demo rows remain intact. */
export async function assertPhysicalJobCard(sql:Reader,jobCardId:string){
 const [card]=await sql.query<{sales_order_id:string}>("select sales_order_id from epr_production_job_cards where id=$1",[jobCardId]);
 if(!card)throw Error("Production job card not found");
 assertPhysicalProductionOrder(card.sales_order_id);
}
export async function assertPhysicalReservation(sql:Reader,reservationId:string){
 const [card]=await sql.query<{sales_order_id:string}>(`select c.sales_order_id from epr_inventory_reservations r
  join epr_production_job_cards c on c.id=r.job_card_id where r.id=$1`,[reservationId]);
 if(!card)throw Error("Production reservation not found");
 assertPhysicalProductionOrder(card.sales_order_id);
}
