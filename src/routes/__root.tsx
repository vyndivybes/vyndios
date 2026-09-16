import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import {
  VAYU_LEGAL_NAME,
  VAYU_LOGO_PATH,
  VYNDI_BRAND_HIERARCHY_LABEL,
  VYNDI_OS_NAME,
  VYNDI_PRODUCT_NAME,
  VIBPE_COPILOT_LABEL,
} from "@/lib/brand";
import { lazy, Suspense, useEffect, useState } from "react";
import "../styles.css";
import "../tansam-vyndi-theme.css";

const LazyPreviewHostBridge = lazy(async () => {
  const module = await import("@/components/preview-host-bridge");
  return { default: module.PreviewHostBridge };
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: `${VYNDI_OS_NAME} · ${VAYU_LEGAL_NAME}` },
      { name: "application-name", content: VYNDI_OS_NAME },
      { name: "apple-mobile-web-app-title", content: VYNDI_OS_NAME },
      { name: "description", content: `${VYNDI_BRAND_HIERARCHY_LABEL}. Governed business execution for Vāyú's VYNDI carbon bicycle platform.` },
      { name: "theme-color", content: "#060809" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/brand/vayu-official.svg" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: Root,
});

function PreviewBridgeBoundary() {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(window.parent !== window);
  }, []);

  if (!embedded) return null;
  return (
    <Suspense fallback={null}>
      <LazyPreviewHostBridge />
    </Suspense>
  );
}

function PageLoadingStatusBar() {
  const isPending = useRouterState({ select: (state) => state.status === "pending" });

  return (
    <div
      data-page-loading-status="route-transition"
      role="status"
      aria-live="polite"
      aria-label={isPending ? "Loading view" : "View ready"}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[250] transition-opacity duration-150 ${
        isPending ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="h-1 w-full overflow-hidden bg-accent/20">
        <div className="h-full w-2/3 bg-accent motion-safe:animate-pulse" />
      </div>
      <div className="absolute right-3 top-2 rounded-full border border-border bg-bg-elevated/95 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent shadow-lg">
        Loading view…
      </div>
    </div>
  );
}

function PrintBrandHeader() {
  return (
    <header className="vyndi-print-brand" aria-hidden="true">
      <img src={VAYU_LOGO_PATH} alt="" className="vyndi-print-brand__mark" />
      <span>
        <strong>{VAYU_LEGAL_NAME}</strong>
        <span>{VYNDI_OS_NAME} → {VIBPE_COPILOT_LABEL} → {VYNDI_PRODUCT_NAME}</span>
      </span>
    </header>
  );
}

function LegalFooter() {
  return (
    <footer className="vyndi-legal-footer" aria-label="Vāyú Shastr copyright notice">
      <span className="vyndi-legal-footer__company">© 2026 Vāyú Shastr Pvt. Ltd.</span>
      <span className="vyndi-legal-footer__separator" aria-hidden="true">•</span>
      <span>All Rights Reserved</span>
      <span className="vyndi-legal-footer__separator" aria-hidden="true">•</span>
      <span>Designed & Developed by S. Shyam Sundhar</span>
    </footer>
  );
}

function Root() {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body className="bg-bg text-fg">
        <PageLoadingStatusBar />
        <PreviewBridgeBoundary />
        <PrintBrandHeader />
        <Outlet />
        <LegalFooter />
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}
