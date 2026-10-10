import { useEffect, useMemo, useState } from "react";
import type { SalesOrder } from "@/lib/finance/sales-engine";
import {
  completeCrmFollowup, getCrmOverview, linkCrmSalesOrder,
  recordCrmActivity, saveCrmCustomer, type CrmOverview,
} from "@/lib/crm-authority";
import { crmSummary, type CrmCustomer, type CrmActivity } from "@/lib/crm-domain";

type Props = { orders: SalesOrder[]; canWrite: boolean };
const blank = () => ({
  kind: "person" as CrmCustomer["kind"], name: "", primaryContact: "",
  email: "", phone: "", city: "", segment: "retail" as CrmCustomer["segment"],
  lifecycle: "prospect" as CrmCustomer["lifecycle"],
});
type Draft = ReturnType<typeof blank>;
const fieldClass = "control mt-1 w-full";
const actionClass = "rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40";
const initial: CrmOverview = { customers: [], activities: [], links: [] };

export function CrmWorkspace({ orders, canWrite }: Props) {
  const [data, setData] = useState<CrmOverview>(initial);
  const [draft, setDraft] = useState<Draft>(blank);
  const [selectedId, setSelectedId] = useState("");
  const [chosenOrder, setChosenOrder] = useState("");
  const [activityKind, setActivityKind] = useState<CrmActivity["kind"]>("followup");
  const [activitySummary, setActivitySummary] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selected = data.customers.find((customer) => customer.id === selectedId);
  const relatedOrders = orders.filter((order) =>
    data.links.some((link) => link.salesOrderId === order.id && link.customerId === selectedId));
  const unlinkedOrders = orders.filter((order) =>
    !data.links.some((link) => link.salesOrderId === order.id));
  const selectedActivities = data.activities.filter((activity) => activity.customerId === selectedId);
  const summary = useMemo(
    () => crmSummary(data.customers, data.activities, data.links, orders, new Date().toISOString().slice(0, 10)),
    [data, orders],
  );

  async function refresh() {
    const overview = await getCrmOverview();
    if (!overview || !Array.isArray(overview.customers) || !Array.isArray(overview.activities) || !Array.isArray(overview.links)) {
      throw new Error("CRM returned an invalid response; no data was accepted.");
    }
    setData(overview);
  }
  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "CRM data unavailable."))
      .finally(() => setLoading(false));
  }, []);

  function pickCustomer(id: string) {
    setSelectedId(id);
    const record = data.customers.find((customer) => customer.id === id);
    setDraft(record ? {
      kind: record.kind, name: record.name, primaryContact: record.primaryContact,
      email: record.email, phone: record.phone, city: record.city,
      segment: record.segment, lifecycle: record.lifecycle,
    } : blank());
    setChosenOrder("");
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "CRM change was rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomer() {
    const id = selected?.id ?? ("CRM-" + crypto.randomUUID());
    const revision = selected?.revision ?? 0;
    await run(
      () => saveCrmCustomer({ data: { id, revision, ...draft } }),
      selected ? "Customer revision persisted and audited." : "Customer created and audited.",
    );
    if (!selected) {
      // Select the exact newly created record only after its readback succeeds.
      const current = await getCrmOverview().catch(() => null);
      if (current?.customers.some((record) => record.id === id)) {
        setData(current);
        setSelectedId(id);
      }
    }
  }

  return (
    <details className="rounded-xl border border-border bg-surface/30 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-fg">
        Customer relationships · Native CRM
        <span className="ml-2 text-xs font-normal text-muted">Customers, opportunities from the order ledger, follow-ups and history</span>
      </summary>
      <div className="mt-4 space-y-4">
        {loading ? <p className="text-xs text-muted">Loading governed CRM register...</p> : null}
        {error ? <p role="alert" className="rounded-md border border-warn p-3 text-xs text-warn">{error}</p> : null}
        {message ? <p role="status" className="rounded-md border border-border p-3 text-xs text-muted">{message}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {([
            ["Customers", summary.customers],
            ["Pipeline leads", summary.opportunityOrders],
            ["Committed orders", summary.committedOrders],
            ["Open follow-ups", summary.openFollowups],
            ["Overdue", summary.overdueFollowups],
          ] as const).map(([label, value]) =>
            <div key={label} className="rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-[10px] uppercase text-subtle">{label}</p>
              <p className="mt-1 text-xl font-semibold text-fg">{value}</p>
            </div>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
          <section className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Customer register</h3>
              <button type="button" className="text-xs font-semibold text-accent" onClick={() => pickCustomer("")}>New customer</button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {data.customers.length === 0 ? <p className="text-xs text-muted">No customer records yet.</p> : null}
              {data.customers.map((customer) =>
                <button type="button" key={customer.id} onClick={() => pickCustomer(customer.id)}
                  className={"w-full rounded-lg border p-2 text-left text-xs " + (customer.id === selectedId ? "border-accent bg-accent/5" : "border-border hover:border-accent/50")}>
                  <span className="block font-semibold text-fg">{customer.name}</span>
                  <span className="text-subtle">{customer.segment} · {customer.lifecycle}</span>
                </button>)}
            </div>
          </section>
          <section className="space-y-4 rounded-xl border border-border p-3">
            <h3 className="text-sm font-semibold">{selected ? "Customer 360° · " + selected.name : "Register customer / dealer"}</h3>
            <fieldset disabled={busy || !canWrite} className="space-y-3 disabled:opacity-60">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs text-muted">Customer name<input className={fieldClass} value={draft.name} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label className="text-xs text-muted">Kind<select className={fieldClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}><option value="person">Individual</option><option value="company">Company</option></select></label>
                <label className="text-xs text-muted">Primary contact<input className={fieldClass} value={draft.primaryContact} onChange={(e) => setDraft({ ...draft, primaryContact: e.target.value })} /></label>
                <label className="text-xs text-muted">Email<input type="email" className={fieldClass} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
                <label className="text-xs text-muted">Phone<input type="tel" className={fieldClass} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
                <label className="text-xs text-muted">City<input className={fieldClass} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></label>
                <label className="text-xs text-muted">Segment<select className={fieldClass} value={draft.segment} onChange={(e) => setDraft({ ...draft, segment: e.target.value as Draft["segment"] })}><option value="retail">Retail</option><option value="dealer">Dealer</option><option value="distributor">Distributor</option><option value="partner">Partner</option></select></label>
                <label className="text-xs text-muted">Relationship<select className={fieldClass} value={draft.lifecycle} onChange={(e) => setDraft({ ...draft, lifecycle: e.target.value as Draft["lifecycle"] })}><option value="prospect">Prospect</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              </div>
              <button type="button" disabled={busy || !canWrite || draft.name.trim().length < 2} className={actionClass} onClick={() => void saveCustomer()}>
                {selected ? "Save customer revision" : "Create customer"}
              </button>
            </fieldset>
            {!canWrite ? <p className="text-xs text-warn">CRM changes require an individually signed-in user with Commercial edit authority.</p> : null}
            {selected ? <>
              <div className="space-y-2 border-t border-border pt-3">
                <h4 className="text-xs font-semibold">Sales pipeline · linked canonical orders</h4>
                {relatedOrders.length === 0 ? <p className="text-xs text-subtle">No orders linked to this customer.</p> : relatedOrders.map((order) =>
                  <p key={order.id} className="text-xs text-muted">{order.id} · {order.status} · {order.units} unit(s)</p>)}
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Unlinked sales order" className="control max-w-full flex-1" value={chosenOrder} disabled={busy || !canWrite} onChange={(e) => setChosenOrder(e.target.value)}>
                    <option value="">Select existing unlinked order</option>
                    {unlinkedOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {order.status}</option>)}
                  </select>
                  <button type="button" className={actionClass} disabled={!chosenOrder || !canWrite || busy}
                    onClick={() => void run(() => linkCrmSalesOrder({ data: { salesOrderId: chosenOrder, customerId: selected.id } }), "Sales order linked; ledger state unchanged.")}>Link order</button>
                </div>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <h4 className="text-xs font-semibold">Interaction log & follow-ups</h4>
                <fieldset disabled={busy || !canWrite} className="space-y-2 disabled:opacity-60">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted">Type<select className={fieldClass} value={activityKind} onChange={(e) => setActivityKind(e.target.value as CrmActivity["kind"])}>
                      <option value="followup">Follow-up</option><option value="call">Call</option><option value="email">Email log</option><option value="meeting">Meeting</option><option value="note">Note</option>
                    </select></label>
                    {activityKind === "followup" ? <label className="text-xs text-muted">Due date<input type="date" className={fieldClass} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label> : null}
                  </div>
                  <label className="block text-xs text-muted">Summary<textarea className={fieldClass} rows={2} maxLength={2000} value={activitySummary} onChange={(e) => setActivitySummary(e.target.value)} /></label>
                  <button type="button" className={actionClass} disabled={busy || !canWrite || activitySummary.trim().length < 2}
                    onClick={() => void run(async () => {
                      await recordCrmActivity({ data: {
                        id: "ACT-" + crypto.randomUUID(), customerId: selected.id, kind: activityKind,
                        summary: activitySummary, dueOn: activityKind === "followup" && dueOn ? dueOn : null,
                      } });
                      setActivitySummary(""); setDueOn("");
                    }, "Interaction recorded with actor audit.")}>Record interaction</button>
                </fieldset>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {selectedActivities.length === 0 ? <p className="text-xs text-subtle">No interactions recorded.</p> : selectedActivities.map((activity) =>
                    <div key={activity.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-2 text-xs">
                      <div><p className="font-semibold text-fg">{activity.kind} · {activity.createdAt.slice(0, 10)}</p>
                        <p className="whitespace-pre-wrap break-words text-muted">{activity.summary}</p>
                        {activity.dueOn ? <p className="text-subtle">Due {activity.dueOn} · {activity.completedAt ? "completed" : "open"}</p> : null}
                      </div>
                      {activity.kind === "followup" && !activity.completedAt ?
                        <button type="button" disabled={busy || !canWrite} className="shrink-0 text-xs font-semibold text-accent disabled:opacity-40"
                          onClick={() => void run(() => completeCrmFollowup({ data: { id: activity.id } }), "Follow-up completed and audited.")}>Complete</button> : null}
                    </div>)}
                </div>
              </div>
            </> : null}
          </section>
        </div>
        <p className="text-xs text-subtle">CRM interactions are internal records; no email or WhatsApp is sent. Leads, confirmed orders and deliveries retain their authority in the Commercial order ledger.</p>
      </div>
    </details>
  );
}
