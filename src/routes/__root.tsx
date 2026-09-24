import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
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
      <div className="h-1 w-full overflow-hidden bg-accent/15 shadow-lg">
        <div className="h-full w-full origin-left bg-gradient-to-r from-transparent via-accent to-transparent motion-safe:animate-pulse" />
      </div>
      <div className="absolute right-3 top-2 rounded-full border border-accent/30 bg-bg-elevated/90 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent shadow-xl backdrop-blur-md">
        Loading view…
      </div>
    </div>
  );
}

function CursorLoadingHalo() {
  const isPending = useRouterState({ select: (state) => state.status === "pending" });
  const [pointer, setPointer] = useState({ x: 24, y: 72, seen: false });

  useEffect(() => {
    if (!isPending) return;
    const move = (event: PointerEvent) => {
      setPointer({ x: event.clientX, y: event.clientY, seen: true });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [isPending]);

  if (!isPending) return null;

  return (
    <div
      data-page-loading-cursor-halo="vayu"
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[260] h-12 w-12 transition-opacity duration-150"
      style={{
        transform: `translate3d(${pointer.x + (pointer.seen ? 16 : 0)}px, ${pointer.y + (pointer.seen ? 16 : 0)}px, 0)`,
      }}
    >
      <div className="absolute inset-0 rounded-full border border-accent/20 bg-bg-elevated/70 shadow-xl backdrop-blur-md" />
      <div className="absolute inset-[3px] rounded-full border-2 border-accent/25 border-r-accent border-t-accent motion-safe:animate-spin motion-reduce:border-accent/60" />
      <div className="absolute inset-[8px] grid place-items-center rounded-full border border-border/70 bg-bg/90 shadow-inner">
        <img src={VAYU_LOGO_PATH} alt="" className="h-6 w-6 object-contain" />
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
        <CursorLoadingHalo />
        <PreviewBridgeBoundary />
        <PrintBrandHeader />
        <Outlet />
        <LegalFooter />
        <Scripts />
      </body>
    </html>
  );
}
