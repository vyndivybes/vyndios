// Fail-closed policy primitives shared by revision proposals and VAOS export gates.
// This module makes no database writes and grants no approval by itself.
const ALLOWED_FIELDS = new Set([
  "title", "domain", "workPackage", "owner", "plannedStart", "plannedFinish",
  "durationDays", "predecessors", "budgetLakh", "milestoneMonth", "scenario",
  "scope", "status", "deferUntil"
]);
const present = (v) => typeof v === "string" && v.trim().length > 0;
const hasOwn = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
export function validateScheduleRevision(revision) {
  const errors = [];
  if (!revision || typeof revision !== "object") return {ok:false,errors:["Revision required"]};
  if (!present(revision.id) || !present(revision.baseRevision) ||
      revision.id === revision.baseRevision) errors.push("Distinct revision and base IDs required");
  if (!present(revision.author) || !present(revision.reason) ||
      !present(revision.sourceReference)) errors.push("Author, reason and evidence required");
  if (!["draft", "submitted", "rejected", "approved", "superseded"].includes(revision.status))
    errors.push("Invalid lifecycle state");
  if (!Array.isArray(revision.changes) || revision.changes.length === 0) {
    errors.push("At least one change required");
  } else for (const change of revision.changes) {
    if (!change || !present(change.taskId) || !ALLOWED_FIELDS.has(change.field) ||
        !hasOwn(change,"before") || !hasOwn(change,"after") ||
        JSON.stringify(change.before) === JSON.stringify(change.after))
      errors.push("Each change needs task, allowed field and different before/after values");
  }
  if (revision.status === "approved") {
    if (!present(revision.reviewer) || revision.reviewer === revision.author ||
        !present(revision.approvedBy) || revision.approvedBy === revision.author ||
        !present(revision.approvalEvidence) || !present(revision.effectiveRevision))
      errors.push("Independent reviewer, approver, evidence and effective revision required");
  }
  return {ok:errors.length===0,errors};
}
export function canMonitorSchedule(revision) {
  if (!validateScheduleRevision(revision).ok || revision.status !== "approved") return false;
  return present(revision.baselineHash) &&
    /^sha256:[a-f0-9]{64}$/i.test(revision.baselineHash) &&
    present(revision.approvedTimezone) &&
    revision.approvedDates === true &&
    present(revision.independentVerifier) &&
    revision.independentVerifier !== revision.author &&
    revision.independentVerifier !== revision.approvedBy;
}
