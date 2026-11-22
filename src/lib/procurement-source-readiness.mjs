/**
 * Procurement reads are safe to render as partial planning only when the
 * existing canonical inventory-source guard explicitly rejects mixed or
 * unclassified ventures. All other authentication, schema and I/O failures
 * must propagate as genuine errors.
 *
 * @param {unknown} error
 */
export function isInventoryVentureSourceHold(error){
 return error instanceof Error && error.message.startsWith('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD:');
}
