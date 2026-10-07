import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { SEED_INVENTORY } from "@/lib/data/inventory";
import { getCommandAccess, getCommandRole } from "@/lib/command-access";
import { canAccessRoute } from "@/lib/page-access";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/inventory")({
  beforeLoad: async () => {
    const access = await getCommandAccess();
    if (!access) throw redirect({ to: "/login", search: { returnTo: "/inventory" } });
    const role = await getCommandRole();
    if (!canAccessRoute(role, "/inventory")) throw redirect({ to: "/command" });
  },
  component: InventoryReferenceCatalogue,
});

const title = (value:string) => value.replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase());

function InventoryReferenceCatalogue() {
  const [filter,setFilter]=useState("all");
  const categories=useMemo(
    ()=>Array.from(new Set(SEED_INVENTORY.map((item)=>item.category))).sort(),
    [],
  );
  const visible=useMemo(
    ()=>filter==="all" ? SEED_INVENTORY : SEED_INVENTORY.filter((item)=>item.category===filter),
    [filter],
  );

  return (
    <div className="min-h-dvh bg-bg">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link to="/range" className="text-sm text-muted hover:text-accent">Range</Link>
            <p className="mt-5 text-[11px] uppercase tracking-[0.22em] text-green">
              Reference only · configurator catalogue
            </p>
            <h1 className="mt-2 text-4xl font-bold text-accent">Component catalogue</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              This compatibility catalogue is read-only reference data for product configuration.
              It is not an ERP writer. Authoritative SKU approval, stock quantity, valuation,
              movements, MSL and FIFO belong only to the governed Inventory authority.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link
                to="/command/inventory"
                className="rounded-md border border-accent/40 px-3 py-1.5 font-semibold text-accent"
              >
                Open ERP Inventory Control →
              </Link>
              <Link
                to="/command/inventory-master"
                className="rounded-md border border-border px-3 py-1.5 text-muted"
              >
                Inventory Master →
              </Link>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Stat label="Reference component models" value={String(SEED_INVENTORY.length)} />
          <Stat label="Reference categories" value={String(categories.length)} />
          <Stat
            label="ERP writer"
            value="None"
            hint="Read-only compatibility catalogue"
          />
        </div>

        <div className="mt-8 flex gap-2 overflow-x-auto pb-1">
          {["all",...categories].map((category)=>(
            <button
              key={category}
              type="button"
              onClick={()=>setFilter(category)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${filter===category?"border-accent bg-accent/10 text-accent":"border-border text-muted"}`}
            >
              {category==="all" ? "All" : title(category)}
            </button>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-border bg-bg-elevated/70">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-green">
              <tr>
                <th className="px-4 py-3">Component</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Reference price</th>
                <th className="px-4 py-3">Reference stock</th>
                <th className="px-4 py-3">Allowed range</th>
                <th className="px-4 py-3">Reference source</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item)=>(
                <tr key={item.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-fg">{item.brand} {item.model}</p>
                    <p className="text-xs text-muted">
                      {title(item.category)} · {item.subcategory} · {item.detail}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{item.sku}</td>
                  <td className="px-4 py-3 tabular-nums">{inr(item.priceInr)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted">
                    {item.stockQty} seed reference
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 text-[10px] font-bold uppercase">
                      {item.coreEnabled && <span>Core</span>}
                      {item.proEnabled && <span>Pro</span>}
                      {item.apexEnabled && <span>Apex</span>}
                    </div>
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-xs text-muted">{item.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-xl border border-warn/30 bg-warn/5 p-4 text-xs leading-5 text-muted">
          <strong className="text-fg">Authority boundary:</strong> values on this page are historical/configurator reference only.
          No change here can create a SKU, receive stock, change valuation, alter MSL or post an inventory movement.
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Stat({label,value,hint}:{label:string;value:string;hint?:string}) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/40 p-4">
      <p className="text-[10px] uppercase tracking-wider text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-accent">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
