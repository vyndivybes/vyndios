import test from "node:test";
import assert from "node:assert/strict";
import { crmSummary } from "./crm-domain.ts";

const customer = {
  id: "CRM-1", revision: 1, kind: "company" as const, name: "Dealer One",
  primaryContact: "", email: "", phone: "", city: "",
  segment: "dealer" as const, lifecycle: "prospect" as const,
};

test("CRM pipeline counts only canonical sales orders linked to a customer", () => {
  const result = crmSummary([customer], [], [
    { salesOrderId: "SO-A", customerId: "CRM-1" },
    { salesOrderId: "SO-B", customerId: "CRM-1" },
    { salesOrderId: "SO-C", customerId: "CRM-UNKNOWN" },
  ], [
    { id: "SO-A", status: "lead" },
    { id: "SO-B", status: "confirmed" },
    { id: "SO-C", status: "lead" },
    { id: "SO-D", status: "lead" },
  ], "2026-10-10");
  assert.equal(result.opportunityOrders, 1);
  assert.equal(result.committedOrders, 1);
  assert.equal(result.customers, 1);
});
test("CRM follow-up metrics exclude completed items and identify overdue dates", () => {
  const result = crmSummary([customer], [
    { id: "A", customerId: "CRM-1", kind: "followup", summary: "Call", dueOn: "2026-10-09", completedAt: null, createdAt: "" },
    { id: "B", customerId: "CRM-1", kind: "followup", summary: "Email", dueOn: "2026-10-10", completedAt: null, createdAt: "" },
    { id: "C", customerId: "CRM-1", kind: "followup", summary: "Done", dueOn: "2026-10-01", completedAt: "2026-10-02", createdAt: "" },
    { id: "D", customerId: "CRM-1", kind: "note", summary: "Note", dueOn: null, completedAt: null, createdAt: "" },
  ], [], [], "2026-10-10");
  assert.equal(result.openFollowups, 2);
  assert.equal(result.overdueFollowups, 1);
});
