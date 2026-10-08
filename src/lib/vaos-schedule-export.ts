/**
 * Minimal, unapproved export of the VYNDI OS program schedule for VAOS.
 * No authority or status elevation follows from this snapshot.
 */
const VALID_STATUS=new Set(["planned","ready","in_progress","blocked","complete","waived"]);
const DATE=/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
type ScheduleRecord = { id?: unknown; owner?: unknown; status?: unknown; planned_finish?: unknown; actual_finish?: unknown };
function required(value: unknown,code: string): string{
 if(typeof value!=="string"||!value.trim())throw new Error(code);
 return value.trim();
}
export function validateScheduleProjectInput(value: {projectId?: unknown} = {}){
 const projectId=value?.projectId;
 if(typeof projectId!=="string"||!ID.test(projectId))throw new Error("SCHEDULE_PROJECT_ID_INVALID");
 return {projectId};
}
function date(value: unknown): string | null{
 if(value===null||value===undefined||value==="")return null;
 if(typeof value!=="string"||!DATE.test(value) || !Number.isFinite(Date.parse(value)))
  throw new Error("SCHEDULE_SOURCE_DATE_INVALID");
 return value;
}
export function normalizeVaosScheduleExport({projectId,capturedAt,records}: {projectId?: unknown; capturedAt?: unknown; records?: unknown} = {}){
 const scope=validateScheduleProjectInput({projectId});
 if(typeof capturedAt!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(capturedAt)
    || !Number.isFinite(Date.parse(capturedAt)))throw new Error("SCHEDULE_CAPTURE_INVALID");
 if(!Array.isArray(records)||!records.length||records.length>100)throw new Error("SCHEDULE_SOURCE_EMPTY");
 const seen=new Set();
 const tasks=(records as ScheduleRecord[]).map(row=>{
  const id=required(row?.id,"SCHEDULE_SOURCE_TASK_ID_INVALID");
  if(!ID.test(id))throw new Error("SCHEDULE_SOURCE_TASK_ID_INVALID");
  if(seen.has(id))throw new Error("SCHEDULE_DUPLICATE_TASK");
  seen.add(id);
  const status=required(row?.status,"SCHEDULE_SOURCE_STATUS_INVALID").toLowerCase();
  if(!VALID_STATUS.has(status))throw new Error("SCHEDULE_SOURCE_STATUS_INVALID");
  return {
   id,
   owner:typeof row?.owner==="string"&&row.owner.trim()?row.owner.trim():null,
   status,
   plannedFinish:date(row?.planned_finish),
   actualFinish:date(row?.actual_finish),
   sourceRef:`vyndi_program_tasks/${id}`,
  };
 }).sort((a,b)=>a.id.localeCompare(b.id));
 return {
  schemaVersion:"vyndi.program.schedule-export.v1",
  sourceSystem:"VYNDI_OS",
  projectId:scope.projectId,
  capturedAt,
  sourceAuthority:"vyndi_program_tasks",
  approvalStatus:"UNAPPROVED_SOURCE_EXPORT",
  tasks,
 };
}
