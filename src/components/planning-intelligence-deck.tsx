import { useState, type ReactNode } from "react";
import { ProgramGatePlan } from "@/components/program-gate-plan";
import { ProgramForecastPanel } from "@/components/program-forecast-panel";
import { MonteCarloPanel } from "@/components/monte-carlo-panel";
import { EarnedValuePanel } from "@/components/earned-value-panel";
import { ForecastLearningPanel } from "@/components/forecast-learning-panel";
import { getProgramPlanningState } from "@/lib/program-planning-authority";
import { getProgramForecastState } from "@/lib/forecast-authority";
import { getMonteCarloState } from "@/lib/monte-carlo-authority";
import { getEarnedValueState } from "@/lib/earned-value-authority";
import { getForecastLearningState } from "@/lib/forecast-learning-authority";
import type { CommandRole } from "@/lib/page-access";

type IntelligenceState = {
  forecastLearning: Awaited<ReturnType<typeof getForecastLearningState>>;
  program: Awaited<ReturnType<typeof getProgramPlanningState>>;
  earnedValue: Awaited<ReturnType<typeof getEarnedValueState>>;
  forecast: Awaited<ReturnType<typeof getProgramForecastState>>;
  monteCarlo: Awaited<ReturnType<typeof getMonteCarloState>>;
};

type IntelligenceKey = keyof IntelligenceState;

function IntelligenceSection({
  title,
  loaded,
  loading,
  error,
  onOpen,
  children,
}: {
  title: string;
  loaded: boolean;
  loading: boolean;
  error: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <details
      className="rounded-xl border border-border bg-surface/25 p-4"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !loading) onOpen();
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold text-accent">
        {title} · {loaded ? "loaded" : loading ? "loading…" : "load on demand"}
      </summary>
      {error ? <p role="alert" className="mt-3 text-xs text-warn">{error}</p> : null}
      {loaded ? <div className="mt-4">{children}</div> : !loading ? (
        <p className="mt-3 text-xs leading-5 text-muted">
          This governed intelligence is advisory and does not block entry to the Integrated Operating Plan.
          Open this section to load the current evidence.
        </p>
      ) : <p className="mt-3 text-xs text-muted">Loading governed evidence…</p>}
    </details>
  );
}

export function PlanningIntelligenceDeck({ role }: { role: CommandRole | null }) {
  const [state, setState] = useState<Partial<IntelligenceState>>({});
  const [loading, setLoading] = useState<Partial<Record<IntelligenceKey, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<IntelligenceKey, string>>>({});

  async function load<K extends IntelligenceKey>(
    key: K,
    loader: () => Promise<IntelligenceState[K]>,
  ) {
    if (state[key] || loading[key]) return;
    setLoading((current) => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      const value = await loader();
      setState((current) => ({ ...current, [key]: value }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Governed intelligence could not be loaded.",
      }));
    } finally {
      setLoading((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <section className="space-y-3" aria-label="Planning intelligence">
      <div className="rounded-xl border border-border bg-surface/35 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-green">
          Planning intelligence · event-driven assurance
        </p>
        <p className="mt-2 text-xs leading-5 text-muted">
          Program controls, forecast learning, Earned Value and Monte Carlo remain governed evidence,
          but they are loaded only when reviewed. They do not consume Worker budget on every Planning navigation.
        </p>
      </div>

      <IntelligenceSection
        title="Forecast Learning Loop"
        loaded={Boolean(state.forecastLearning)}
        loading={Boolean(loading.forecastLearning)}
        error={errors.forecastLearning ?? ""}
        onOpen={() => void load("forecastLearning", getForecastLearningState)}
      >
        {state.forecastLearning ? <ForecastLearningPanel state={state.forecastLearning} /> : null}
      </IntelligenceSection>

      <IntelligenceSection
        title="Program Gate Plan"
        loaded={Boolean(state.program)}
        loading={Boolean(loading.program)}
        error={errors.program ?? ""}
        onOpen={() => void load("program", getProgramPlanningState)}
      >
        {state.program ? <ProgramGatePlan role={role} state={state.program} /> : null}
      </IntelligenceSection>

      <IntelligenceSection
        title="Earned Value"
        loaded={Boolean(state.earnedValue)}
        loading={Boolean(loading.earnedValue)}
        error={errors.earnedValue ?? ""}
        onOpen={() => void load("earnedValue", getEarnedValueState)}
      >
        {state.earnedValue ? <EarnedValuePanel state={state.earnedValue} /> : null}
      </IntelligenceSection>

      <IntelligenceSection
        title="Program Forecast"
        loaded={Boolean(state.forecast)}
        loading={Boolean(loading.forecast)}
        error={errors.forecast ?? ""}
        onOpen={() => void load("forecast", getProgramForecastState)}
      >
        {state.forecast ? <ProgramForecastPanel state={state.forecast} /> : null}
      </IntelligenceSection>

      <IntelligenceSection
        title="Monte Carlo Uncertainty"
        loaded={Boolean(state.monteCarlo)}
        loading={Boolean(loading.monteCarlo)}
        error={errors.monteCarlo ?? ""}
        onOpen={() => void load("monteCarlo", getMonteCarloState)}
      >
        {state.monteCarlo ? <MonteCarloPanel state={state.monteCarlo} /> : null}
      </IntelligenceSection>
    </section>
  );
}
