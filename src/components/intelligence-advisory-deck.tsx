import { useState, type ReactNode } from "react";
import { Kpi } from "@/components/kpi";
import { ForecastLearningPanel } from "@/components/forecast-learning-panel";
import { getProgramForecastState } from "@/lib/forecast-authority";
import { getMonteCarloState } from "@/lib/monte-carlo-authority";
import { getDecisionIntelligenceState } from "@/lib/decision-intelligence-authority";
import { getEarnedValueState } from "@/lib/earned-value-authority";
import { getForecastLearningState } from "@/lib/forecast-learning-authority";

type AdvisoryState = {
  forecast: Awaited<ReturnType<typeof getProgramForecastState>>;
  monteCarlo: Awaited<ReturnType<typeof getMonteCarloState>>;
  decision: Awaited<ReturnType<typeof getDecisionIntelligenceState>>;
  earnedValue: Awaited<ReturnType<typeof getEarnedValueState>>;
  forecastLearning: Awaited<ReturnType<typeof getForecastLearningState>>;
};

type AdvisoryKey = keyof AdvisoryState;

const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const money = (value: number) => `₹${number(value)} lakh`;

function AdvisorySection({
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
          Governed advisory evidence is loaded only when reviewed. It does not block Product Intelligence entry.
        </p>
      ) : <p className="mt-3 text-xs text-muted">Loading governed evidence…</p>}
    </details>
  );
}

export function IntelligenceAdvisoryDeck() {
  const [state, setState] = useState<Partial<AdvisoryState>>({});
  const [loading, setLoading] = useState<Partial<Record<AdvisoryKey, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AdvisoryKey, string>>>({});

  async function load<K extends AdvisoryKey>(key: K, loader: () => Promise<AdvisoryState[K]>) {
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

  const earnedValue = state.earnedValue;
  const forecast = state.forecast;
  const monteCarlo = state.monteCarlo;
  const decision = state.decision;

  return (
    <section className="space-y-3" aria-label="Product Intelligence advisory evidence">
      <div className="rounded-xl border border-border bg-surface/35 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-green">
          Advisory intelligence · review-driven
        </p>
        <p className="mt-2 text-xs leading-5 text-muted">
          Forecast Learning, Earned Value, Program Forecast, Monte Carlo and Decision Intelligence remain governed.
          They load only when an operator opens the relevant review section.
        </p>
      </div>

      <AdvisorySection
        title="Forecast Learning"
        loaded={Boolean(state.forecastLearning)}
        loading={Boolean(loading.forecastLearning)}
        error={errors.forecastLearning ?? ""}
        onOpen={() => void load("forecastLearning", getForecastLearningState)}
      >
        {state.forecastLearning ? <ForecastLearningPanel state={state.forecastLearning} allowActions={false} /> : null}
      </AdvisorySection>

      <AdvisorySection
        title="Earned Value"
        loaded={Boolean(earnedValue)}
        loading={Boolean(loading.earnedValue)}
        error={errors.earnedValue ?? ""}
        onOpen={() => void load("earnedValue", getEarnedValueState)}
      >
        {earnedValue ? earnedValue.latest ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
            <Kpi label="BAC" value={money(earnedValue.latest.result.bacLakh)} hint="Budget at completion" />
            <Kpi label="PV" value={money(earnedValue.latest.result.pvLakh)} hint="Planned value" />
            <Kpi label="EV" value={money(earnedValue.latest.result.evLakh)} hint="Evidence-derived" />
            <Kpi label="AC" value={money(earnedValue.latest.result.acLakh)} hint="Actual cost" />
            <Kpi label="SPI" value={earnedValue.latest.result.spi == null ? "WITHHELD" : number(earnedValue.latest.result.spi)} hint="EV / PV" tone={earnedValue.latest.result.spi != null && earnedValue.latest.result.spi < 1 ? "warn" : "ok"} />
            <Kpi label="CPI" value={earnedValue.latest.result.cpi == null ? "WITHHELD" : number(earnedValue.latest.result.cpi)} hint="EV / AC" tone={earnedValue.latest.result.cpi != null && earnedValue.latest.result.cpi < 1 ? "warn" : "ok"} />
            <Kpi label="EAC" value={earnedValue.latest.result.eacLakh == null ? "WITHHELD" : money(earnedValue.latest.result.eacLakh)} hint="BAC / CPI" />
            <Kpi label="VAC" value={earnedValue.latest.result.vacLakh == null ? "WITHHELD" : money(earnedValue.latest.result.vacLakh)} hint="BAC - EAC" tone={earnedValue.latest.result.vacLakh != null && earnedValue.latest.result.vacLakh < 0 ? "warn" : "ok"} />
            <p className="sm:col-span-2 xl:col-span-8 text-xs text-muted">
              Source {earnedValue.latest.sourceReference} · captured {earnedValue.latest.createdAt}. Earned Value is computed from governed task progress/completion and actual-cost evidence; it never authorizes budget, payment, schedule or release actions.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted">
            <p>{earnedValue.live.reason}</p>
            <p className="mt-2 text-xs">Progress evidence coverage {number(earnedValue.live.progressCoveragePct)}% · actual-cost evidence coverage {number(earnedValue.live.actualCostCoveragePct)}%.</p>
          </div>
        ) : null}
      </AdvisorySection>

      <AdvisorySection
        title="Program forecast"
        loaded={Boolean(forecast)}
        loading={Boolean(loading.forecast)}
        error={errors.forecast ?? ""}
        onOpen={() => void load("forecast", getProgramForecastState)}
      >
        {forecast ? forecast.latest ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi label="Schedule P50" value={forecast.latest.result.schedule.p50Days == null ? "WITHHELD" : `${forecast.latest.result.schedule.p50Days} d`} hint="From program start" />
            <Kpi label="Schedule P80" value={forecast.latest.result.schedule.p80Days == null ? "WITHHELD" : `${forecast.latest.result.schedule.p80Days} d`} hint="Planning quantile" />
            <Kpi label="Schedule P95" value={forecast.latest.result.schedule.p95Days == null ? "WITHHELD" : `${forecast.latest.result.schedule.p95Days} d`} hint="Planning quantile" />
            <Kpi label="Cost P50" value={forecast.latest.result.cost.p50Lakh == null ? "WITHHELD" : money(forecast.latest.result.cost.p50Lakh)} hint="Governed cost inputs" />
            <Kpi label="Cost P80" value={forecast.latest.result.cost.p80Lakh == null ? "WITHHELD" : money(forecast.latest.result.cost.p80Lakh)} hint="Planning quantile" />
            <Kpi label="Cost P95" value={forecast.latest.result.cost.p95Lakh == null ? "WITHHELD" : money(forecast.latest.result.cost.p95Lakh)} hint="Planning quantile" />
            <p className="sm:col-span-2 xl:col-span-6 text-xs text-muted">
              Source {forecast.latest.sourceReference} · captured {forecast.latest.createdAt}. PERT-normal approximation only; critical-path switching and correlation are not modeled.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Schedule coverage {number(forecast.live.schedule.coveragePct)}% · cost coverage {number(forecast.live.cost.coveragePct)}%. Quantiles remain withheld until a governed forecast run is captured from complete three-point inputs.
          </p>
        ) : null}
      </AdvisorySection>

      <AdvisorySection
        title="Monte Carlo program uncertainty"
        loaded={Boolean(monteCarlo)}
        loading={Boolean(loading.monteCarlo)}
        error={errors.monteCarlo ?? ""}
        onOpen={() => void load("monteCarlo", getMonteCarloState)}
      >
        {monteCarlo ? monteCarlo.latest ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi label="MC Schedule P50" value={monteCarlo.latest.result.schedule.p50Days == null ? "WITHHELD" : `${monteCarlo.latest.result.schedule.p50Days} d`} hint="Critical path resampled" />
            <Kpi label="MC Schedule P80" value={monteCarlo.latest.result.schedule.p80Days == null ? "WITHHELD" : `${monteCarlo.latest.result.schedule.p80Days} d`} hint="Planning quantile" />
            <Kpi label="MC Schedule P95" value={monteCarlo.latest.result.schedule.p95Days == null ? "WITHHELD" : `${monteCarlo.latest.result.schedule.p95Days} d`} hint="Planning quantile" />
            <Kpi label="MC Cost P50" value={monteCarlo.latest.result.cost.p50Lakh == null ? "WITHHELD" : money(monteCarlo.latest.result.cost.p50Lakh)} hint="Cost-required tasks" />
            <Kpi label="Dominant path" value={monteCarlo.latest.result.schedule.criticalPathFrequency[0] ? `${number(monteCarlo.latest.result.schedule.criticalPathFrequency[0].frequencyPct)}%` : "—"} hint={monteCarlo.latest.result.schedule.criticalPathFrequency[0]?.path.join(" → ") || "No path evidence"} />
            <Kpi label="Run evidence" value={monteCarlo.latest.id.slice(0, 12)} hint={monteCarlo.latest.sourceReference} />
            <p className="sm:col-span-2 xl:col-span-6 text-xs text-muted">
              Triangular task distributions with critical-path recalculation each iteration. Cross-task correlation is not yet modeled. This is program uncertainty, not a physical material/FEA/fatigue response model.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Schedule O/M/P coverage {number(monteCarlo.scheduleInputCoveragePct)}%. Monte Carlo remains withheld until all governed program tasks have complete schedule distributions and a run is captured.
          </p>
        ) : null}
      </AdvisorySection>

      <AdvisorySection
        title="Decision Intelligence"
        loaded={Boolean(decision)}
        loading={Boolean(loading.decision)}
        error={errors.decision ?? ""}
        onOpen={() => void load("decision", getDecisionIntelligenceState)}
      >
        {decision ? (
          <div className="space-y-3">
            {decision.live.options.map((option, index) => (
              <article key={option.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-green">
                      Option {index + 1} · {option.decisionClass.replaceAll("_", " ")}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-fg">{option.title}</h3>
                  </div>
                  {decision.live.primaryAdvisoryOptionId === option.id ? (
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
                      Primary advisory
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">{option.rationale}</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Actions</p>
                    <ul className="mt-1 space-y-1">{option.actions.map((item) => <li key={item} className="text-xs leading-5 text-muted">• {item}</li>)}</ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Consequences / limits</p>
                    <ul className="mt-1 space-y-1">{option.consequences.map((item) => <li key={item} className="text-xs leading-5 text-muted">• {item}</li>)}</ul>
                  </div>
                </div>
                <p className="mt-3 text-[10px] leading-4 text-subtle">{option.authorityRequired}</p>
                {option.evidenceReferences.length ? <p className="mt-1 break-words text-[10px] text-subtle">Evidence: {option.evidenceReferences.join(" · ")}</p> : null}
              </article>
            ))}
            <p className="text-[10px] leading-5 text-subtle">
              Ranking method: {decision.live.rankingMethod}. Governance-priority ordering only; no option is an approval, commitment, engineering release, purchase order, funding decision or risk acceptance.
            </p>
          </div>
        ) : null}
      </AdvisorySection>
    </section>
  );
}
