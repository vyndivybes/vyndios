import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  createProgramDependency,
  createProgramTask,
  transitionProgramTaskStatus,
} from "@/lib/program-planning-authority";
import { canPerform, type CommandRole } from "@/lib/page-access";

type Row = Record<string, unknown>;
type ProgramState = {
  program: Row | null;
  tasks: Row[];
  dependencies: Row[];
  network: {
    valid: boolean;
    projectDurationDays: number | null;
    criticalPath: string[];
    cycleTaskIds: string[];
    issues: { code: string; message: string }[];
    taskById: Record<string, {
      earliestStartDay: number;
      earliestFinishDay: number;
      latestStartDay: number;
      latestFinishDay: number;
      slackDays: number;
      critical: boolean;
    } | undefined>;
  };
};

const text = (row: Row, key: string) => row[key] == null ? "" : String(row[key]);
const asList = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const splitList = (value: string) => value.split(",").map((x) => x.trim()).filter(Boolean);
const optionalNumber = (value: string, divisor = 1) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / divisor : null;
};

const EMPTY_TASK = {
  id: "",
  title: "",
  domain: "engineering",
  workPackage: "",
  owner: "",
  durationDays: "5",
  plannedStart: "",
  plannedFinish: "",
  gateId: "",
  requiredEvidence: "",
  riskIds: "",
  costLakh: "",
  confidence: "",
  sourceReference: "",
};

export function ProgramGatePlan({ role, state }: { role: CommandRole | null; state: ProgramState }) {
  const router = useRouter();
  const editable = Boolean(role && canPerform(role, "edit"));
  const [showTask, setShowTask] = useState(false);
  const [task, setTask] = useState(EMPTY_TASK);
  const [dependency, setDependency] = useState({ predecessorId:"", successorId:"", lagDays:"0", sourceReference:"" });
  const [statusDraft, setStatusDraft] = useState<Record<string,string>>({});
  const [actualStart, setActualStart] = useState<Record<string,string>>({});
  const [actualFinish, setActualFinish] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const blocked = state.tasks.filter((row) => text(row,"status") === "blocked").length;
  const complete = state.tasks.filter((row) => text(row,"status") === "complete").length;
  const criticalSet = useMemo(() => new Set(state.network.criticalPath), [state.network.criticalPath]);

  async function addTask() {
    setBusy("task");
    setMessage("");
    try {
      await createProgramTask({
        data: {
          id: task.id.trim(),
          title: task.title.trim(),
          domain: task.domain.trim() || "program",
          workPackage: task.workPackage.trim(),
          owner: task.owner.trim(),
          status: "planned",
          durationDays: Math.max(1, Math.round(Number(task.durationDays) || 0)),
          plannedStart: task.plannedStart,
          plannedFinish: task.plannedFinish,
          actualStart: "",
          actualFinish: "",
          gateId: task.gateId.trim(),
          requiredInputs: [],
          requiredEvidence: splitList(task.requiredEvidence),
          riskIds: splitList(task.riskIds),
          estimatedEffortHours: null,
          actualEffortHours: null,
          costLakh: optionalNumber(task.costLakh),
          confidence: optionalNumber(task.confidence, 100),
          technicalMaturity: null,
          sourceReference: task.sourceReference.trim(),
        },
      });
      setTask(EMPTY_TASK);
      setShowTask(false);
      setMessage("Governed program task created.");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create program task.");
    } finally {
      setBusy("");
    }
  }

  async function addDependency() {
    setBusy("dependency");
    setMessage("");
    try {
      await createProgramDependency({
        data: {
          predecessorId: dependency.predecessorId,
          successorId: dependency.successorId,
          lagDays: Math.max(0, Math.round(Number(dependency.lagDays) || 0)),
          sourceReference: dependency.sourceReference.trim(),
        },
      });
      setDependency({ predecessorId:"", successorId:"", lagDays:"0", sourceReference:"" });
      setMessage("Dependency added; critical path recalculated.");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create dependency.");
    } finally {
      setBusy("");
    }
  }

  async function saveStatus(row: Row) {
    const id = text(row,"id");
    const status = (statusDraft[id] || text(row,"status")) as "planned"|"ready"|"in_progress"|"blocked"|"complete"|"waived";
    setBusy(id);
    setMessage("");
    try {
      await transitionProgramTaskStatus({
        data: {
          id,
          status,
          actualStart: actualStart[id] || text(row,"actual_start"),
          actualFinish: actualFinish[id] || text(row,"actual_finish"),
          sourceReference: "UI:PROGRAM_GATE_PLAN",
        },
      });
      setMessage(`${id} execution state updated with audit evidence.`);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update program task.");
    } finally {
      setBusy("");
    }
  }

  return <div className="space-y-5">
    <Panel title="Program & Gate Planning" kicker="Governed work packages · dependencies · critical path · evidence gates">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Program tasks" value={String(state.tasks.length)} hint="Persisted governed tasks"/>
        <Kpi label="Critical tasks" value={String(state.network.criticalPath.length)} hint={state.network.valid ? "Zero-slack network" : "Network invalid"} tone={state.network.valid ? "ok" : "danger"}/>
        <Kpi label="Blocked" value={String(blocked)} hint="Execution state" tone={blocked ? "danger" : "ok"}/>
        <Kpi label="Completed" value={String(complete)} hint={state.tasks.length ? `${Math.round((complete/state.tasks.length)*100)}% of tasks` : "No tasks yet"}/>
        <Kpi label="Critical duration" value={state.network.projectDurationDays == null ? "—" : `${state.network.projectDurationDays} d`} hint="Deterministic CPM"/>
      </div>

      {message ? <div role="status" className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}
      {!state.network.valid ? <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4">{state.network.issues.map((issue)=><p key={issue.code+issue.message} className="text-xs text-danger">{issue.code}: {issue.message}</p>)}</div> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={!editable} onClick={()=>setShowTask((value)=>!value)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-accent disabled:opacity-40">{showTask ? "Close task form" : "Add governed task"}</button>
      </div>

      {showTask ? <div className="mt-4 rounded-xl border border-border bg-surface/30 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-muted">Task ID<input className="control mt-1.5 w-full" value={task.id} onChange={(e)=>setTask({...task,id:e.target.value})}/></label>
          <label className="text-xs text-muted">Title<input className="control mt-1.5 w-full" value={task.title} onChange={(e)=>setTask({...task,title:e.target.value})}/></label>
          <label className="text-xs text-muted">Domain<input className="control mt-1.5 w-full" value={task.domain} onChange={(e)=>setTask({...task,domain:e.target.value})}/></label>
          <label className="text-xs text-muted">Work package<input className="control mt-1.5 w-full" value={task.workPackage} onChange={(e)=>setTask({...task,workPackage:e.target.value})}/></label>
          <label className="text-xs text-muted">Owner<input className="control mt-1.5 w-full" value={task.owner} onChange={(e)=>setTask({...task,owner:e.target.value})}/></label>
          <label className="text-xs text-muted">Duration days<input type="number" min="1" className="control mt-1.5 w-full" value={task.durationDays} onChange={(e)=>setTask({...task,durationDays:e.target.value})}/></label>
          <label className="text-xs text-muted">Planned start<input type="date" className="control mt-1.5 w-full" value={task.plannedStart} onChange={(e)=>setTask({...task,plannedStart:e.target.value})}/></label>
          <label className="text-xs text-muted">Planned finish<input type="date" className="control mt-1.5 w-full" value={task.plannedFinish} onChange={(e)=>setTask({...task,plannedFinish:e.target.value})}/></label>
          <label className="text-xs text-muted">Gate ID<input className="control mt-1.5 w-full" value={task.gateId} onChange={(e)=>setTask({...task,gateId:e.target.value})}/></label>
          <label className="text-xs text-muted">Cost ₹L<input inputMode="decimal" className="control mt-1.5 w-full" value={task.costLakh} onChange={(e)=>setTask({...task,costLakh:e.target.value})}/></label>
          <label className="text-xs text-muted">Confidence %<input inputMode="decimal" className="control mt-1.5 w-full" value={task.confidence} onChange={(e)=>setTask({...task,confidence:e.target.value})}/></label>
          <label className="text-xs text-muted md:col-span-2">Required evidence<input className="control mt-1.5 w-full" value={task.requiredEvidence} onChange={(e)=>setTask({...task,requiredEvidence:e.target.value})} placeholder="EVID-..., TEST-..."/></label>
          <label className="text-xs text-muted md:col-span-2">Linked risks<input className="control mt-1.5 w-full" value={task.riskIds} onChange={(e)=>setTask({...task,riskIds:e.target.value})} placeholder="RISK-..."/></label>
          <label className="text-xs text-muted md:col-span-2">Source / evidence reference<input className="control mt-1.5 w-full" value={task.sourceReference} onChange={(e)=>setTask({...task,sourceReference:e.target.value})}/></label>
        </div>
        <button type="button" disabled={!editable || busy==="task" || !task.id.trim() || !task.title.trim() || !task.sourceReference.trim()} onClick={()=>void addTask()} className="mt-4 rounded bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">Create program task</button>
      </div> : null}

      {state.tasks.length >= 2 ? <div className="mt-4 rounded-xl border border-border bg-surface/25 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-green">Add finish-to-start dependency</p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs text-muted">Predecessor<select className="control mt-1.5 w-full" value={dependency.predecessorId} onChange={(e)=>setDependency({...dependency,predecessorId:e.target.value})}><option value="">Select</option>{state.tasks.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"id")} · {text(row,"title")}</option>)}</select></label>
          <label className="text-xs text-muted">Successor<select className="control mt-1.5 w-full" value={dependency.successorId} onChange={(e)=>setDependency({...dependency,successorId:e.target.value})}><option value="">Select</option>{state.tasks.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"id")} · {text(row,"title")}</option>)}</select></label>
          <label className="text-xs text-muted">Lag days<input type="number" min="0" className="control mt-1.5 w-full" value={dependency.lagDays} onChange={(e)=>setDependency({...dependency,lagDays:e.target.value})}/></label>
          <label className="text-xs text-muted">Source reference<input className="control mt-1.5 w-full" value={dependency.sourceReference} onChange={(e)=>setDependency({...dependency,sourceReference:e.target.value})}/></label>
        </div>
        <button type="button" disabled={!editable || busy==="dependency" || !dependency.predecessorId || !dependency.successorId || !dependency.sourceReference.trim()} onClick={()=>void addDependency()} className="mt-3 rounded border border-accent px-3 py-2 text-xs font-semibold text-accent disabled:opacity-40">Link dependency</button>
      </div> : null}
    </Panel>

    <Panel title="Program Network" kicker="Earliest/latest timing · slack · critical path · planned vs actual">
      {state.tasks.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1450px] text-sm">
        <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Task</th><th className="px-3 py-3 text-left">Owner</th><th className="px-3 py-3 text-left">Duration</th><th className="px-3 py-3 text-left">CPM</th><th className="px-3 py-3 text-left">Plan / actual</th><th className="px-3 py-3 text-left">Gate / evidence / risk</th><th className="px-3 py-3 text-left">Execution</th></tr></thead>
        <tbody>{state.tasks.map((row)=>{
          const id=text(row,"id");
          const schedule=state.network.taskById[id];
          const critical=criticalSet.has(id);
          const evidence=asList(row.required_evidence);
          const risks=asList(row.risk_ids);
          return <tr key={id} className={`border-t border-border/70 align-top ${critical ? "bg-warn/5" : ""}`}>
            <td className="px-3 py-3"><p className="font-semibold">{text(row,"title")}</p><p className="font-mono text-[10px] text-subtle">{id} · {text(row,"domain")} · {text(row,"work_package") || "no package"}</p></td>
            <td className="px-3 py-3 text-muted">{text(row,"owner") || "Unassigned"}</td>
            <td className="px-3 py-3 font-semibold">{text(row,"duration_days")} d</td>
            <td className="px-3 py-3"><p className={critical ? "font-semibold text-warn" : "font-semibold"}>{critical ? "CRITICAL" : `${schedule?.slackDays ?? "—"} d slack`}</p><p className="text-[10px] text-muted">ES {schedule?.earliestStartDay ?? "—"} · EF {schedule?.earliestFinishDay ?? "—"} · LS {schedule?.latestStartDay ?? "—"} · LF {schedule?.latestFinishDay ?? "—"}</p></td>
            <td className="px-3 py-3 text-xs text-muted"><p>Plan {text(row,"planned_start") || "—"} → {text(row,"planned_finish") || "—"}</p><p>Actual {text(row,"actual_start") || "—"} → {text(row,"actual_finish") || "—"}</p></td>
            <td className="px-3 py-3 text-xs text-muted"><p className="font-semibold text-fg">{text(row,"gate_id") || "No gate"}</p><p>{evidence.length ? `${evidence.length} evidence ref(s)` : "No evidence refs"}</p><p>{risks.length ? `${risks.length} linked risk(s)` : "No linked risks"}</p></td>
            <td className="px-3 py-3"><div className="grid gap-2">
              <select disabled={!editable} className="control min-w-36" value={statusDraft[id] || text(row,"status")} onChange={(e)=>setStatusDraft({...statusDraft,[id]:e.target.value})}><option value="planned">Planned</option><option value="ready">Ready</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option><option value="waived">Waived</option></select>
              <div className="flex gap-2"><input type="date" disabled={!editable} className="control w-36 text-xs" value={actualStart[id] ?? text(row,"actual_start")} onChange={(e)=>setActualStart({...actualStart,[id]:e.target.value})}/><input type="date" disabled={!editable} className="control w-36 text-xs" value={actualFinish[id] ?? text(row,"actual_finish")} onChange={(e)=>setActualFinish({...actualFinish,[id]:e.target.value})}/></div>
              <button type="button" disabled={!editable || busy===id} onClick={()=>void saveStatus(row)} className="rounded border border-border px-2 py-1.5 text-xs font-semibold hover:border-accent disabled:opacity-40">Save state</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">No governed program tasks have been entered yet. Add the first task above; VYNDI calculates the network only from explicit durations and dependencies.</div>}
    </Panel>

    <p className="text-xs text-muted">This is deterministic CPM only. VYNDI does not produce P50/P80/P95 here; probabilistic scheduling is reserved for the Forecast Engine once governed uncertainty inputs exist.</p>
  </div>;
}
