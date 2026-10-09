export type CrmCustomer = {
  id: string;
  revision: number;
  kind: "person" | "company";
  name: string;
  primaryContact: string;
  email: string;
  phone: string;
  city: string;
  segment: "retail" | "dealer" | "distributor" | "partner";
  lifecycle: "prospect" | "active" | "inactive";
};
export type CrmActivity = {
  id: string;
  customerId: string;
  kind: "note" | "call" | "email" | "meeting" | "followup";
  summary: string;
  dueOn: string | null;
  completedAt: string | null;
  createdAt: string;
};
export type CrmOrderLink = { salesOrderId: string; customerId: string };
export type CrmOrderStatus = "lead" | "confirmed" | "delivered" | "cancelled";
export type CrmOrder = { id: string; status: CrmOrderStatus };
export function crmSummary(
  customers: CrmCustomer[],
  activities: CrmActivity[],
  links: CrmOrderLink[],
  salesOrders: CrmOrder[],
  asOf: string,
) {
  const linked = new Map(links.map((link) => [link.salesOrderId, link.customerId]));
  const validCustomers = new Set(customers.map((customer) => customer.id));
  const opportunityOrders = salesOrders.filter((order) =>
    order.status === "lead" && validCustomers.has(linked.get(order.id) ?? ""));
  const committedOrders = salesOrders.filter((order) =>
    (order.status === "confirmed" || order.status === "delivered") &&
    validCustomers.has(linked.get(order.id) ?? ""));
  const pending = activities.filter((activity) => activity.kind === "followup" && !activity.completedAt && validCustomers.has(activity.customerId));
  return {
    customers: customers.length,
    opportunityOrders: opportunityOrders.length,
    committedOrders: committedOrders.length,
    openFollowups: pending.length,
    overdueFollowups: pending.filter((activity) => Boolean(activity.dueOn && activity.dueOn < asOf)).length,
  };
}
