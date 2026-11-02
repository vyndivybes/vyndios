/** The exact legacy demo orders accepted for memory-only simulation. */
export const FOUR_ORDER_DEMO_IDS = [
 "SO-02ca96da-5206-4b94-9fef-062a2a992919",
 "SO-69e011a9-2c99-4ffa-82f7-39eef01bf05e",
 "SO-800d46b7-d354-4e80-a3a9-d6c2207be5bf",
 "SO-991bfe7e-85f6-4849-a5d0-04c2792606e3",
] as const;
const ids=new Set<string>(FOUR_ORDER_DEMO_IDS);
export function isFourOrderDemoOrder(id:string){return ids.has(id);}
export function assertPhysicalProductionOrder(id:string){
 if(!id||isFourOrderDemoOrder(id))throw Error("Demo / legacy source is not a physical production release. Design confirmation and genuine engineering approval are required; use the simulation workspace.");
}
