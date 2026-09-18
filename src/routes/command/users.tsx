import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  approveVindyUserRoleChange,
  captureVindyAccessCertification,
  emergencyApplyVindyUserRoleChange,
  getVindyAccessGovernance,
  rejectVindyUserRoleChange,
  type AccessGovernanceWorkspace,
  type PendingRoleChangeRow,
} from "@/lib/access-governance";
import {
  createVindyUser,
  deleteVindyUser,
  getVindyUserContext,
  listVindyUsers,
  resetVindyUserPassword,
  setVindyUserRole,
} from "@/lib/vindy-users";
import type { CommandRole } from "@/lib/page-access";

export const Route = createFileRoute("/command/users")({ component: UsersPage });

const roles: CommandRole[] = ["admin","management","board","finance","operations","engineering","qa","compliance","viewer"];

type VindyUser = {
  id:string;
  name:string|null;
  email:string|null;
  role:string|null;
  created_at:string;
  role_updated_at?:string|null;
  active_sessions?:number;
};

function cardClass() {
  return "rounded-2xl border border-slate-300 bg-white p-5 shadow-sm";
}

function UsersPage() {
  const [me,setMe]=useState<{id:string|null;role:CommandRole|null;bootstrapAdmin?:boolean}|null>(null);
  const [users,setUsers]=useState<VindyUser[]>([]);
  const [governance,setGovernance]=useState<AccessGovernanceWorkspace|null>(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [showCreate,setShowCreate]=useState(false);
  const [resetUser,setResetUser]=useState<VindyUser|null>(null);
  const [resetPassword,setResetPassword]=useState("");
  const [resetPasswordConfirm,setResetPasswordConfirm]=useState("");
  const [form,setForm]=useState({name:"",email:"",password:"",role:"viewer" as CommandRole});

  async function refresh() {
    try {
      setError("");
      const context=await getVindyUserContext();
      setMe(context);
      if(context?.role==="admin") {
        const [userRows,access]=await Promise.all([listVindyUsers(),getVindyAccessGovernance()]);
        setUsers(userRows as VindyUser[]);
        setGovernance(access);
      }
    } catch(err) {
      setError(err instanceof Error ? err.message : "Unable to load access governance.");
    }
  }

  useEffect(()=>{ void refresh(); },[]);

  async function run(task:()=>Promise<unknown>,success:string) {
    try {
      setBusy(true);
      setError("");
      setMessage("");
      await task();
      setMessage(success);
      await refresh();
    } catch(err) {
      setError(err instanceof Error ? err.message : "Access-governance action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestRole(user:VindyUser,nextRole:CommandRole) {
    if(nextRole===user.role) return;
    const reason=window.prompt(`Reason for changing ${user.email ?? user.id} from ${user.role ?? "unassigned"} to ${nextRole}`)?.trim();
    if(!reason) return;
    await run(
      ()=>setVindyUserRole({data:{userId:user.id,role:nextRole,reason}}),
      "Role-change request raised. A different administrator must approve it before the role changes.",
    );
  }

  async function createUser() {
    if(!form.name.trim()||!form.email.trim()||form.password.length<8) return;
    await run(async()=>{
      const result=await createVindyUser({data:form});
      setForm({name:"",email:"",password:"",role:"viewer"});
      setShowCreate(false);
      if(result.pendingRoleRequestId) {
        setMessage(`Account created as Viewer. Requested role ${form.role} is pending maker/checker approval.`);
      }
    },"Account created. Any privileged requested role is governed through maker/checker approval.");
  }

  async function resetPasswordForUser() {
    if(!resetUser) return;
    if(resetPassword.length<8) { setError("Password must be at least 8 characters."); return; }
    if(resetPassword!==resetPasswordConfirm) { setError("The passwords do not match."); return; }
    await run(
      ()=>resetVindyUserPassword({data:{userId:resetUser.id,password:resetPassword}}),
      "Password reset completed and recorded in privileged access history.",
    );
    setResetUser(null);
    setResetPassword("");
    setResetPasswordConfirm("");
  }

  async function removeUser(user:VindyUser) {
    if(user.id===me?.id) return;
    if(!window.confirm(`Delete ${user.email ?? user.id}? Pending role-change requests must be resolved first.`)) return;
    await run(
      ()=>deleteVindyUser({data:{userId:user.id}}),
      "User account deleted and privileged access event recorded.",
    );
  }

  async function approve(request:PendingRoleChangeRow) {
    const note=window.prompt("Approval note (optional)")?.trim() ?? "";
    await run(
      ()=>approveVindyUserRoleChange({data:{requestId:request.id,note}}),
      "Role change approved by checker and applied.",
    );
  }

  async function reject(request:PendingRoleChangeRow) {
    const note=window.prompt("Rejection reason")?.trim();
    if(!note) return;
    await run(
      ()=>rejectVindyUserRoleChange({data:{requestId:request.id,note}}),
      "Role-change request rejected and retained in access history.",
    );
  }

  async function emergencyApply(request:PendingRoleChangeRow) {
    const reason=window.prompt("BREAK-GLASS reason — explain why a second administrator cannot perform checker approval")?.trim();
    if(!reason||reason.length<8) return;
    if(!window.confirm("Apply this role change using the audited bootstrap-admin break-glass path?")) return;
    await run(
      ()=>emergencyApplyVindyUserRoleChange({data:{requestId:request.id,reason}}),
      "Emergency role change applied. The override is permanently flagged for the next access certification.",
    );
  }

  async function certify() {
    const reference=window.prompt("Access-certification evidence / review reference")?.trim();
    if(!reference) return;
    await run(
      ()=>captureVindyAccessCertification({data:{sourceReference:reference}}),
      "Immutable access-certification snapshot captured.",
    );
  }

  if(me?.role!=="admin") {
    return <div className="p-8"><h1 className="text-2xl font-semibold text-slate-950">User Access</h1><p className="mt-2 text-sm font-medium text-slate-700">Administrator access is required.</p>{error&&<p className="mt-4 text-sm font-medium text-red-700">{error}</p>}</div>;
  }

  const pending=governance?.pending ?? [];
  const exceptions=governance?.exceptions ?? [];
  const latestCertification=governance?.certifications?.[0];

  return (
    <main className="space-y-6 p-8 text-slate-950">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-600">VYNDI OS • H4 IAM / SOD</p>
          <h1 className="mt-2 text-3xl font-semibold">User Access Control</h1>
          <p className="mt-2 max-w-4xl text-sm font-medium text-slate-700">Single-role least privilege · different-admin maker/checker for routine role changes · immutable privileged-access history · periodic certification.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={()=>void refresh()} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Refresh</button>
          <button type="button" onClick={()=>void certify()} disabled={busy} className="rounded-xl border border-slate-950 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40">Capture certification</button>
          <button type="button" onClick={()=>{setError("");setShowCreate(true);}} className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-slate-950">+ Create user</button>
        </div>
      </header>

      {message&&<p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{message}</p>}
      {error&&<p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}

      <section className="grid gap-4 md:grid-cols-4">
        <div className={cardClass()}><p className="text-xs font-bold uppercase text-slate-500">Users</p><p className="mt-2 text-3xl font-semibold">{users.length}</p></div>
        <div className={cardClass()}><p className="text-xs font-bold uppercase text-slate-500">Pending role changes</p><p className="mt-2 text-3xl font-semibold">{pending.length}</p></div>
        <div className={cardClass()}><p className="text-xs font-bold uppercase text-slate-500">Access exceptions</p><p className="mt-2 text-3xl font-semibold">{exceptions.length}</p></div>
        <div className={cardClass()}><p className="text-xs font-bold uppercase text-slate-500">Last certification</p><p className="mt-2 text-sm font-semibold">{latestCertification ? new Date(latestCertification.created_at).toLocaleString() : "Not yet captured"}</p>{latestCertification&&<p className="mt-1 text-xs text-slate-600">{latestCertification.exception_count} exception(s)</p>}</div>
      </section>

      {showCreate&&<section className="rounded-2xl border border-orange-300 bg-orange-50 p-5">
        <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Create VYNDI user</h2><p className="mt-1 text-xs font-medium text-slate-700">Non-bootstrap accounts start as Viewer. A more privileged requested role becomes a pending maker/checker request.</p></div><button type="button" onClick={()=>setShowCreate(false)} className="text-sm font-semibold">Cancel</button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold">Name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5" /></label>
          <label className="text-sm font-semibold">Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5" /></label>
          <label className="text-sm font-semibold">Temporary password<input type="password" minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5" /></label>
          <label className="text-sm font-semibold">Requested role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value as CommandRole})} className="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5">{roles.map(role=><option key={role} value={role}>{role}</option>)}</select></label>
        </div>
        <div className="mt-5 flex justify-end"><button type="button" disabled={busy||!form.name.trim()||!form.email.trim()||form.password.length<8} onClick={()=>void createUser()} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Create account</button></div>
      </section>}

      <section className={cardClass()}>
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-orange-600">Maker / checker queue</p><h2 className="mt-1 text-xl font-semibold">Pending role changes</h2><p className="mt-1 text-xs text-slate-600">The requesting administrator cannot approve the same request. Break-glass is visible only to the configured bootstrap administrator and is permanently flagged.</p></div></div>
        <div className="mt-4 grid gap-3">
          {!pending.length&&<p className="text-sm text-slate-600">No pending access changes.</p>}
          {pending.map(row=><article key={row.id} className="rounded-xl border border-slate-200 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-orange-700">{row.id}</p><p className="mt-1 font-semibold">{row.target_name||row.target_email||row.target_user_id}</p><p className="mt-1 text-slate-600">{row.from_role||"unassigned"} → <span className="font-semibold text-slate-900">{row.to_role}</span></p><p className="mt-1 text-xs text-slate-600">{row.reason}</p><p className="mt-1 text-xs text-slate-500">Maker: {row.requested_by}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy||row.requested_by===me?.id} onClick={()=>void approve(row)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Approve</button><button type="button" disabled={busy} onClick={()=>void reject(row)} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40">Reject</button>{governance?.me.bootstrapAdmin&&<button type="button" disabled={busy} onClick={()=>void emergencyApply(row)} className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-40">Break-glass apply</button>}</div></div>
          </article>)}
        </div>
      </section>

      <section className={cardClass()}>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Certification exceptions</p>
        <h2 className="mt-1 text-xl font-semibold">Current access review</h2>
        <p className="mt-1 text-xs text-slate-600">Certification captures this exact user/role/session/pending-request state as immutable evidence.</p>
        <div className="mt-4 grid gap-2">{!exceptions.length?<p className="text-sm font-semibold text-emerald-700">No current access exceptions.</p>:exceptions.map((item,index)=><div key={`${item.code}-${item.userId??index}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><span className="font-bold">{item.severity.toUpperCase()} · {item.code}</span><span className="ml-2 text-slate-600">{item.message}</span></div>)}</div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-300 bg-white shadow-sm">
        <div className="min-w-[1180px]">
          <div className="grid grid-cols-[1fr_1.4fr_1.6fr_.8fr_.7fr_1fr_1.2fr] gap-4 border-b border-slate-300 bg-slate-100 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-700"><span>User</span><span>Email</span><span>User ID</span><span>Role</span><span>Sessions</span><span>Role updated</span><span>Actions</span></div>
          {!users.length&&<div className="px-5 py-10 text-center text-sm text-slate-600">No VYNDI users are registered yet.</div>}
          {users.map(user=><div key={user.id} className="grid grid-cols-[1fr_1.4fr_1.6fr_.8fr_.7fr_1fr_1.2fr] items-center gap-4 border-b border-slate-200 px-5 py-4 text-sm">
            <span className="font-semibold">{user.name||"Unnamed user"}</span>
            <span className="break-all text-slate-700">{user.email||"—"}</span>
            <span className="break-all font-mono text-xs">{user.id}</span>
            <select aria-label={`Requested role for ${user.email??user.id}`} value={user.role||"viewer"} onChange={e=>void requestRole(user,e.target.value as CommandRole)} className="rounded-lg border border-slate-400 bg-white px-2 py-2 font-semibold">{roles.map(role=><option key={role} value={role}>{role}</option>)}</select>
            <span className={Number(user.active_sessions??0)>3?"font-bold text-red-700":"font-semibold"}>{user.active_sessions??0}</span>
            <span className="text-xs text-slate-600">{user.role_updated_at?new Date(user.role_updated_at).toLocaleString():"—"}</span>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>{setResetUser(user);setResetPassword("");setResetPasswordConfirm("");}} className="rounded-lg border border-orange-300 px-3 py-2 text-xs font-bold text-orange-700 disabled:opacity-40">Reset password</button><button type="button" disabled={busy||user.id===me?.id} onClick={()=>void removeUser(user)} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40">Delete</button></div>
          </div>)}
        </div>
      </section>

      <section className={cardClass()}>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Privileged history</p>
        <h2 className="mt-1 text-xl font-semibold">Recent access events</h2>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="py-2">When</th><th>Event</th><th>Target</th><th>Actor</th><th>Role change</th><th>Reason</th></tr></thead><tbody>{(governance?.events??[]).map(row=><tr key={row.id} className="border-b border-slate-100"><td className="py-2 pr-3 text-xs">{new Date(row.created_at).toLocaleString()}</td><td className="pr-3 font-semibold">{row.event_type}</td><td className="pr-3 font-mono text-xs">{row.target_user_id||"—"}</td><td className="pr-3 font-mono text-xs">{row.actor_user_id}</td><td className="pr-3">{row.role_before||"—"} → {row.role_after||"—"}</td><td className="text-slate-600">{row.reason||"—"}</td></tr>)}</tbody></table></div>
      </section>

      {resetUser&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="presentation"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-6 shadow-2xl"><h2 className="text-xl font-semibold">Reset password</h2><p className="mt-1 text-sm text-slate-600">{resetUser.email||resetUser.id}</p><div className="mt-5 space-y-4"><input autoFocus type="password" minLength={8} value={resetPassword} onChange={e=>setResetPassword(e.target.value)} placeholder="New password" className="w-full rounded-xl border border-slate-400 px-3 py-2.5" /><input type="password" minLength={8} value={resetPasswordConfirm} onChange={e=>setResetPasswordConfirm(e.target.value)} placeholder="Confirm password" className="w-full rounded-xl border border-slate-400 px-3 py-2.5" /></div><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setResetUser(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="button" disabled={busy||resetPassword.length<8||resetPassword!==resetPasswordConfirm} onClick={()=>void resetPasswordForUser()} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Set new password</button></div></section></div>}
    </main>
  );
}
