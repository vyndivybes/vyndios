import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { CommandShell } from "@/components/command-shell";
import { ProtectedNavigationBridge } from "@/components/protected-navigation-bridge";
import { getCommandRole } from "@/lib/command-access";
import { canAccessRoute } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";
import { useOperatingPlanSync } from "@/lib/operating-plan-sync";

const LazyIbpeWorkspaceProjection = lazy(async () => {
  const module = await import("@/components/ibpe-workspace-projection");
  return { default: module.IbpeWorkspaceProjection };
});

const LazyControlledDocumentToolbar = lazy(async () => {
  const module = await import("@/components/controlled-document-toolbar");
  return { default: module.ControlledDocumentToolbar };
});

const LazyTraceabilityDocumentCentre = lazy(async () => {
  const module = await import("@/components/traceability-document-centre-v2");
  return { default: module.TraceabilityDocumentCentreV2 };
});

const LazyIbpeCopilot = lazy(async () => {
  const module = await import("@/components/ibpe-copilot");
  return { default: module.IbpeCopilot };
});

const CONTROLLED_DOCUMENT_ROUTES = new Set([
  "/command/sales",
  "/command/production",
  "/command/purchase-execution",
  "/command/receiving",
  "/command/quality",
  "/command/operations",
  "/command/receivables",
]);

const COMMAND_FULL_VIEW_CSS = `
[data-vyndi-full-view="command-system"] {
  width: 100%;
  max-width: 100vw;
  overflow-x: clip;
}

[data-vyndi-full-view="command-system"] .max-w-7xl {
  width: 100% !important;
  max-width: none !important;
}

[data-vyndi-full-view="command-system"] :where(main, section, article, fieldset, form, nav, div) {
  min-width: 0;
}

[data-vyndi-full-view="command-system"] fieldset > * {
  min-width: 0;
  max-width: 100%;
}

[data-vyndi-full-view="command-system"] :where(.overflow-x-auto, .overflow-x-scroll) {
  overflow-x: visible !important;
  max-width: 100% !important;
}

[data-vyndi-full-view="command-system"] nav.overflow-x-auto > .min-w-max {
  display: flex;
  width: 100%;
  min-width: 0 !important;
  flex-wrap: wrap;
}

[data-vyndi-full-view="command-system"] [class*="min-w-["] {
  min-width: 0 !important;
}

[data-vyndi-full-view="command-system"] table {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  table-layout: fixed;
}

[data-vyndi-full-view="command-system"] :where(th, td) {
  min-width: 0 !important;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}

[data-vyndi-full-view="command-system"] :where(table input, table select, table textarea, table button) {
  min-width: 0;
  max-width: 100%;
}

[data-vyndi-full-view="command-system"] :where(svg, canvas, img, .recharts-responsive-container) {
  max-width: 100% !important;
}

[data-vyndi-full-view="command-system"] pre {
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 1279px) {
  [data-vyndi-full-view="command-system"] table {
    font-size: clamp(0.62rem, 0.78vw, 0.78rem);
  }

  [data-vyndi-full-view="command-system"] :where(th, td) {
    padding-left: 0.35rem !important;
    padding-right: 0.35rem !important;
  }
}
`;

function normalizeCommandPath(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export const Route = createFileRoute("/command")({
  beforeLoad: async ({ location }) => {
    // One scalar role lookup proves both authenticated Command access and RBAC.
    // This avoids resolving the same Better Auth identity + persisted role two
    // or three times during every protected navigation.
    const role = await getCommandRole();
    if (!role) {
      throw redirect({
        to: "/login",
        search: { returnTo: location.pathname },
      });
    }

    const routePath = normalizeCommandPath(location.pathname);
    if (routePath !== "/command" && !canAccessRoute(role, routePath)) {
      const page = getRouteMeta(routePath);
      const preferredTarget =
        page?.adminOnly && page.domain === "inventory" ? "/command/inventory" : "/command";
      throw redirect({
        to: normalizeCommandPath(preferredTarget) === routePath ? "/command" : preferredTarget,
      });
    }

    return { commandRole: role };
  },
  component: CommandRoot,
});

function DeferredCommandTools() {
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Keep non-critical floating tools off the first paint. They become
    // available immediately after the protected page has had time to settle.
    const timer = window.setTimeout(() => setReady(true), 180);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready) return null;
  const routePath = normalizeCommandPath(pathname);

  return (
    <Suspense fallback={null}>
      {CONTROLLED_DOCUMENT_ROUTES.has(routePath) ? <LazyControlledDocumentToolbar /> : null}
      <LazyTraceabilityDocumentCentre />
      <LazyIbpeCopilot />
    </Suspense>
  );
}

function CommandRoot() {
  const { commandRole } = Route.useRouteContext();
  useOperatingPlanSync();
  return (
    <>
      <ProtectedNavigationBridge />
      <style>{COMMAND_FULL_VIEW_CSS}</style>
      <div data-vyndi-full-view="command-system">
        <Suspense fallback={null}>
          <LazyIbpeWorkspaceProjection />
        </Suspense>
        <CommandShell initialRole={commandRole} />
        <DeferredCommandTools />
      </div>
    </>
  );
}