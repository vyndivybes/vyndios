import { useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Compass, PlayCircle, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  GUIDED_WORK_AUTHORITY_NOTICE,
  resolveGuidedWork,
  type GuidedWorkMode,
  type GuidedWorkStep,
} from "@/lib/guided-work";
import type { CommandRole } from "@/lib/page-access";
import { cn } from "@/lib/utils";

const MODE_KEY = "vyndi:guided-work:mode";
const OPEN_KEY = "vyndi:guided-work:open";

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
  const guide = useMemo(() => resolveGuidedWork(role, pathname), [pathname, role]);

  useEffect(() => {
    window.localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  }, [open]);

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
        className="fixed bottom-5 left-3 z-40 inline-flex min-h-12 items-center gap-2 rounded-full border border-accent/35 bg-bg/95 px-4 py-3 text-sm font-semibold text-fg shadow-2xl backdrop-blur-xl transition hover:border-accent hover:bg-surface sm:left-5"
        aria-label="Open VYNDI Guided Work"
      >
        <Compass className="size-4 text-accent" />
        <span>Guide</span>
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-3 left-3 right-3 z-40 max-h-[78dvh] overflow-hidden rounded-2xl border border-border bg-bg/95 shadow-2xl backdrop-blur-xl sm:bottom-5 sm:left-5 sm:right-auto sm:w-[420px]"
      aria-label="VYNDI Guided Work"
    >
      <header className="border-b border-border bg-surface/55 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-green">
              VYNDI Guided Work
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-fg">{guide.department}</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Optional operating guidance · current route aware · RBAC filtered
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

      <div className="max-h-[56dvh] overflow-y-auto px-4 py-4 [scrollbar-width:thin]">
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
      </div>

      <footer className="border-t border-border bg-surface/45 px-4 py-3">
        <p className="text-[10px] leading-4 text-subtle">{GUIDED_WORK_AUTHORITY_NOTICE}</p>
      </footer>
    </aside>
  );
}
