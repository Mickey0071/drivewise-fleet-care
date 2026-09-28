import { supabase } from "@/integrations/supabase/client";

export type TitleStatus = "Clean" | "Salvage" | "Rebuilt" | "Other";
export type PaperworkIssue = "title" | "registration" | "tags";
export type PaperworkTaskType = "dmv" | "title_transfer" | "tag_order";

export const TASK_TYPE_LABEL: Record<PaperworkTaskType, string> = {
  dmv: "DMV",
  title_transfer: "Title transfer",
  tag_order: "Tag order",
};
export const ISSUE_LABEL: Record<PaperworkIssue, string> = {
  title: "No title",
  registration: "No registration on file",
  tags: "No tags on vehicle",
};
export const DEFAULT_TASK_FOR_ISSUE: Record<PaperworkIssue, PaperworkTaskType> = {
  title: "title_transfer",
  registration: "dmv",
  tags: "tag_order",
};

export interface PaperworkForm {
  titled: boolean | null;
  titleState: string;
  titleNumber: string;
  titleStatus: TitleStatus | "";
  titlePhoto: File | null;
  registrationOnFile: boolean | null;
  registrationPhoto: File | null;
  registrationExpiry: string;
  tagsOnVehicle: boolean | null;
  plate: string;
  tagState: string;
  tagExpiry: string;
  insuranceCard: boolean | null;
  notes: string;
}

export const EMPTY_PAPERWORK: PaperworkForm = {
  titled: null, titleState: "", titleNumber: "", titleStatus: "", titlePhoto: null,
  registrationOnFile: null, registrationPhoto: null, registrationExpiry: "",
  tagsOnVehicle: null, plate: "", tagState: "", tagExpiry: "",
  insuranceCard: null, notes: "",
};

export interface DraftPaperworkTask {
  issue: PaperworkIssue;
  taskType: PaperworkTaskType;
  assignee: string;
  dueDate: string;
  notes: string;
}

export function paperworkIssues(f: PaperworkForm): PaperworkIssue[] {
  const out: PaperworkIssue[] = [];
  if (f.titled === false) out.push("title");
  if (f.registrationOnFile === false) out.push("registration");
  if (f.tagsOnVehicle === false) out.push("tags");
  return out;
}

/** Returns an error message, or null when Step 1 is complete. */
export function validatePaperwork(f: PaperworkForm): string | null {
  if (f.titled === null || f.registrationOnFile === null || f.tagsOnVehicle === null || f.insuranceCard === null)
    return "Answer every Yes / No question";
  if (f.titled && (!f.titleState || !f.titleNumber.trim() || !f.titleStatus))
    return "Enter title state, number, and status";
  if (f.registrationOnFile && !f.registrationExpiry) return "Enter the registration expiration date";
  if (f.tagsOnVehicle && (!f.plate.trim() || !f.tagState || !f.tagExpiry))
    return "Enter plate number, state, and tag expiration";
  if (paperworkIssues(f).length > 0 && !f.notes.trim())
    return "A note is required when title, registration, or tags are marked No";
  return null;
}

async function uploadDoc(vehicleId: string, kind: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${vehicleId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("vehicle-documents").upload(path, file, {
    upsert: true, contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

export async function signedDocUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("vehicle-documents").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function saveOnboardingRecord(vehicleId: string, f: PaperworkForm, tasks: DraftPaperworkTask[]) {
  const { data: u } = await supabase.auth.getUser();
  const titlePath = f.titled && f.titlePhoto ? await uploadDoc(vehicleId, "title", f.titlePhoto) : null;
  const regPath = f.registrationOnFile && f.registrationPhoto ? await uploadDoc(vehicleId, "registration", f.registrationPhoto) : null;
  const { error } = await supabase.from("vehicle_onboarding" as never).insert({
    vehicle_id: vehicleId,
    titled: !!f.titled,
    title_state: f.titled ? f.titleState : null,
    title_number: f.titled ? f.titleNumber.trim() : null,
    title_status: f.titled ? f.titleStatus : null,
    title_photo_path: titlePath,
    registration_on_file: !!f.registrationOnFile,
    registration_photo_path: regPath,
    registration_expiry: f.registrationOnFile ? f.registrationExpiry || null : null,
    tags_on_vehicle: !!f.tagsOnVehicle,
    plate: f.tagsOnVehicle ? f.plate.trim().toUpperCase() : null,
    tag_state: f.tagsOnVehicle ? f.tagState : null,
    tag_expiry: f.tagsOnVehicle ? f.tagExpiry || null : null,
    insurance_card: !!f.insuranceCard,
    notes: f.notes.trim() || null,
    created_by: u.user?.id ?? null,
  } as never);
  if (error) throw error;
  if (tasks.length) await createPaperworkTasks(vehicleId, tasks);
}

export async function createPaperworkTasks(vehicleId: string, tasks: DraftPaperworkTask[]) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("paperwork_tasks" as never).insert(
    tasks.map((t) => ({
      vehicle_id: vehicleId, issue: t.issue, task_type: t.taskType,
      assignee: t.assignee.trim(), due_date: t.dueDate || null,
      notes: t.notes.trim() || null, created_by: u.user?.id ?? null,
    })) as never,
  );
  if (error) throw error;
}

export interface OnboardingRow {
  id: string; vehicle_id: string; created_at: string;
  titled: boolean; title_state: string | null; title_number: string | null; title_status: string | null;
  title_photo_path: string | null;
  registration_on_file: boolean; registration_photo_path: string | null; registration_expiry: string | null;
  tags_on_vehicle: boolean; plate: string | null; tag_state: string | null; tag_expiry: string | null;
  insurance_card: boolean; notes: string | null;
}
export interface PaperworkTaskRow {
  id: string; vehicle_id: string; issue: PaperworkIssue; task_type: PaperworkTaskType;
  assignee: string; due_date: string | null; status: "open" | "done"; notes: string | null;
  completed_at: string | null; created_at: string;
}

export async function loadVehiclePaperwork(vehicleId: string) {
  const [o, t] = await Promise.all([
    supabase.from("vehicle_onboarding" as never).select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }),
    supabase.from("paperwork_tasks" as never).select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }),
  ]);
  return {
    onboarding: ((o.data ?? []) as unknown as OnboardingRow[]),
    tasks: ((t.data ?? []) as unknown as PaperworkTaskRow[]),
  };
}

export async function loadAllPaperworkTasks() {
  const { data, error } = await supabase.from("paperwork_tasks" as never).select("*").order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as PaperworkTaskRow[];
}

export async function setPaperworkTaskStatus(id: string, status: "open" | "done") {
  const { error } = await supabase.from("paperwork_tasks" as never)
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null } as never)
    .eq("id", id);
  if (error) throw error;
}
