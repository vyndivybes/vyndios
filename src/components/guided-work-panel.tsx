import { useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Compass, GripHorizontal, PlayCircle, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  GUIDED_WORK_AUTHORITY_NOTICE,
  resolveGuidedWork,
  type GuidedWorkMode,
  type GuidedWorkStep,
} from "@/lib/guided-work";
import { canAccessRoute, type CommandRole } from "@/lib/page-access";
import { WORKSPACE_NAVIGATION } from "@/lib/operating-workflow";
import { cn } from "@/lib/utils";

const MODE_KEY = "vyndi:guided-work:mode";
const OPEN_KEY = "vyndi:guided-work:open";
const POSITION_KEY = "vyndi:guided-work:position";

type FloatingPosition = { x: number; y: number };
type DragState = { pointerId: number; offsetX: number; offsetY: number };

function initialPosition(): FloatingPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPosition>;
    return typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

function clampPosition(x: number, y: number, width: number, height: number): FloatingPosition {
  const gutter = 12;
  const maxX = Math.max(gutter, window.innerWidth - width - gutter);
  const maxY = Math.max(gutter, window.innerHeight - height - gutter);
  return {
    x: Math.min(Math.max(gutter, x), maxX),
    y: Math.min(Math.max(gutter, y), maxY),
  };
}

function initialMode(): GuidedWorkMode {
  if (typeof window === "undefined") return "work";
  return window.localStorage.getItem(MODE_KEY) === "learn" ? "learn" : "work";
}

function initialOpen() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(OPEN_KEY) === "1";
}

export function GuidedWorkPanel({ role }: { role: CommandRole | null }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(initialOpen);
  const [mode, setMode] = useState<GuidedWorkMode>(initialMode);
  const [scope, setScope] = useState<"all" | "page">("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [position, setPosition] = useState<FloatingPosition | null>(initialPosition);
  const [isDesktop, setIsDesktop] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const guide = useMemo(() => resolveGuidedWork(role, pathname), [pathname, role]);
  const features = useMemo(() => {
    const entries = new Map<string, { to: string; label: string; section: string; workspace: string }>();
    for (const [workspace, sections] of Object.entries(WORKSPACE_NAVIGATION)) {
      if (workspace === "admin" && role !== "admin") continue;
      for (const section of sections) {
        for (const item of section.items) {
          if (canAccessRoute(role, item.to) && !entries.has(item.to)) {
            entries.set(item.to, { ...item, section: section.label, workspace });
          }
        }
      }
    }
    return [...entries.values()];
  }, [role]);
  const filteredFeatures = useMemo(() => features.filter((feature) =>
    (category === "all" || feature.workspace === category) &&
    `${feature.label} ${feature.section} ${feature.workspace}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [category, features, query]);
  const floatingStyle = useMemo<CSSProperties | undefined>(
    () => (isDesktop && position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined),
    [isDesktop, position],
  );

  useEffect(() => {
    window.localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  }, [open]);

  useEffect(() => {
    if (position) window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  }, [position]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open || !isDesktop) return;

    const keepInBounds = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition((current) => {
        if (!current) return current;
        const rect = panel.getBoundingClientRect();
        return clampPosition(current.x, current.y, rect.width, rect.height);
      });
    };

    keepInBounds();
    window.addEventListener("resize", keepInBounds);
    return () => window.removeEventListener("resize", keepInBounds);
  }, [isDesktop, open]);


  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!isDesktop || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;

    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPosition({ x: rect.left, y: rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || drag.pointerId !== event.pointerId) return;

    const rect = panel.getBoundingClientRect();
    setPosition(
      clampPosition(
        event.clientX - drag.offsetX,
        event.clientY - drag.offsetY,
        rect.width,
        rect.height,
      ),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function openStep(step: GuidedWorkStep) {
    await navigate({ to: step.to as never });
  }

  function askVyndi(step?: GuidedWorkStep) {
    const question =
      step?.question ??
      `Guide me through the current ${guide.department} workflow on ${pathname}. Explain the next governed step, why it matters, the evidence I should verify, and what still requires explicit human authority.`;

    window.dispatchEvent(
      new CustomEvent("vyndi:copilot-open", {
        detail: {
          question,
          source: "guided-work",
          route: pathname,
          department: guide.department,
        },
      }),
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-4 z-50 inline-flex min-h-12 items-center gap-2 rounded-full border border-accent/35 bg-bg/95 px-4 py-3 text-sm font-semibold text-fg shadow-2xl backdrop-blur-xl transition hover:border-accent hover:bg-surface sm:bottom-5 sm:right-5"
        aria-label="Open VYNDI Guided Work"
      >
        <Compass className="size-4 text-accent" />
        <span>Guide</span>
      </button>
    );
  }

  return (
    <aside
      ref={panelRef}
      style={floatingStyle}
      className="fixed bottom-[env(safe-area-inset-bottom,0px)] left-2 right-2 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-2xl border border-border bg-bg/95 shadow-2xl backdrop-blur-xl sm:bottom-5 sm:left-5 sm:right-auto sm:w-[420px]"
      aria-label="VYNDI Guided Work"
      role="dialog"
      aria-modal="false"
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
    >
      <header
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="shrink-0 select-none border-b border-border bg-surface/55 px-4 py-3 sm:cursor-move sm:touch-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-green">
              VYNDI Guided Work
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-fg">{guide.department}</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Optional operating guidance · current route aware · RBAC filtered
            </p>
            <p className="mt-1 hidden items-center gap-1 text-[10px] text-subtle sm:flex">
              <GripHorizontal className="size-3" /> Drag this header to move the Guide
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:border-accent/40 hover:text-fg"
            aria-label="Close Guided Work"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-xl border border-border bg-bg/60 p-1">
          <button
            type="button"
            onClick={() => setMode("learn")}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
              mode === "learn" ? "bg-accent/12 text-accent" : "text-muted hover:text-fg",
            )}
          >
            <BookOpen className="size-3.5" />
            Learn mode
          </button>
          <button
            type="button"
            onClick={() => setMode("work")}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
              mode === "work" ? "bg-accent/12 text-accent" : "text-muted hover:text-fg",
            )}
          >
            <PlayCircle className="size-3.5" />
            Work mode
          </button>
        </div>
      </header>

      <nav className="flex shrink-0 gap-2 border-b border-border px-4 py-2" aria-label="Guide scope">
        <button type="button" onClick={() => setScope("all")} aria-pressed={scope === "all"} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", scope === "all" ? "bg-accent/15 text-accent" : "text-muted")}>All Features</button>
        <button type="button" onClick={() => setScope("page")} aria-pressed={scope === "page"} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", scope === "page" ? "bg-accent/15 text-accent" : "text-muted")}>On this page</button>
      </nav>
      <div className="min-h-0 max-h-[55dvh] flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin]">
        {scope === "all" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">{features.length} authorised destinations · based on VYNDI OS navigation</p>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search VYNDI features" aria-label="Search VYNDI features"
              className="control w-full" />
            <select value={category} onChange={(event) => setCategory(event.target.value)}
              aria-label="Filter features by workspace" className="control w-full">
              <option value="all">All workspaces</option>
              {[...new Set(features.map((item) => item.workspace))].map((workspace) => (
                <option key={workspace} value={workspace}>{workspace.replaceAll("-", " & ")}</option>
              ))}
            </select>
            {filteredFeatures.map((feature) => (
              <article key={feature.to} className="rounded-xl border border-border bg-surface/30 p-3">
                <p className="text-sm font-semibold text-fg">{feature.label}</p>
                <p className="mt-1 text-xs text-muted">{feature.section} · {feature.workspace.replaceAll("-", " & ")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { void navigate({ to: feature.to as never }); setOpen(false); }}
                    className="rounded-lg border border-accent/35 px-3 py-2 text-xs font-semibold text-accent">Open feature</button>
                  <button type="button" onClick={() => askVyndi({
                    label: feature.label, to: feature.to, reason: feature.section,
                    question: `Explain the ${feature.label} feature in VYNDI OS, its workflow and required authority. Do not execute actions or assume approval.`
                  })} className="rounded-lg border border-border px-3 py-2 text-xs text-muted">Ask VYNDI</button>
                </div>
              </article>
            ))}
            {!filteredFeatures.length && <p role="status" className="text-sm text-muted">No authorised features match this search.</p>}
          </div>
        ) : (
          <>
        {mode === "learn" ? (
          <div className="space-y-4">
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-green">Purpose</p>
              <p className="mt-1 text-sm leading-6 text-fg">{guide.purpose}</p>
            </section>

            <section className="rounded-xl border border-border bg-surface/35 p-3">
              <p className="text-xs font-semibold text-accent">Why?</p>
              <p className="mt-1 text-xs leading-5 text-muted">{guide.why}</p>
            </section>

            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-green">Procedure</p>
              <ol className="mt-2 space-y-2">
                {guide.procedure.map((step, index) => (
                  <li key={step} className="flex gap-3 text-xs leading-5 text-muted">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/8 text-[10px] font-semibold text-accent">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <button
              type="button"
              onClick={() => askVyndi()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-accent/35 bg-accent/8 px-3 py-2.5 text-xs font-semibold text-accent hover:bg-accent/12"
            >
              <Sparkles className="size-3.5" />
              Ask VYNDI about this workflow
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-green">Next step</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Only destinations allowed by your current VYNDI role are shown.
              </p>
            </div>

            {guide.accessibleSteps.length ? (
              guide.accessibleSteps.map((step, index) => (
                <article key={step.to} className="rounded-xl border border-border bg-surface/30 p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">{step.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{step.reason}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openStep(step)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/8 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/12"
                    >
                      Open step <ChevronRight className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => askVyndi(step)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-accent/35 hover:text-fg"
                    >
                      <Sparkles className="size-3.5" />
                      Ask VYNDI
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-xl border border-border bg-surface/30 p-3 text-xs leading-5 text-muted">
                No next-step destination is available to the current role from this workflow. Use Learn mode or ask VYNDI for read-only guidance.
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-border bg-surface/45 px-4 py-3">
        <p className="text-[10px] leading-4 text-subtle">{GUIDED_WORK_AUTHORITY_NOTICE}</p>
      </footer>
    </aside>
  );
}

