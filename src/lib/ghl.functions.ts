import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const ItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  done: z.boolean(),
});

const InputSchema = z.object({
  reportId: z.string().min(1).max(64),
  runnerName: z.string().min(1).max(120),
  runnerEmail: z.string().email().optional(),
  runnerPhone: z.string().min(3).max(40).optional(),
  submittedAt: z.string().min(1).max(64),
  totalTasks: z.number().int().min(0).max(500),
  completedTasks: z.number().int().min(0).max(500),
  items: z.array(ItemSchema).min(0).max(500),
  notes: z.string().max(4000).optional(),
});

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function buildNoteBody(d: z.infer<typeof InputSchema>) {
  const lines: string[] = [];
  lines.push(`Runner Report ${d.reportId}`);
  lines.push(`Runner: ${d.runnerName}`);
  lines.push(`Submitted: ${new Date(d.submittedAt).toLocaleString()}`);
  lines.push(`Progress: ${d.completedTasks}/${d.totalTasks}`);
  lines.push("");
  lines.push("Checklist:");
  for (const it of d.items) {
    const mark = it.done ? "[x]" : "[ ]";
    lines.push(`${mark} ${it.label}${it.detail ? ` — ${it.detail}` : ""}`);
  }
  if (d.notes) {
    lines.push("");
    lines.push("Notes:");
    lines.push(d.notes);
  }
  return lines.join("\n");
}

async function findOrCreateContact(opts: {
  token: string;
  locationId: string;
  name: string;
  email?: string;
  phone?: string;
}): Promise<string> {
  const { token, locationId, name, email, phone } = opts;
  // 1. Try duplicate lookup if we have an email
  if (email) {
    const url = new URL(`${GHL_BASE}/contacts/search/duplicate`);
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("email", email);
    const r = await fetch(url.toString(), { headers: ghlHeaders(token) });
    if (r.ok) {
      const j = (await r.json()) as { contact?: { id?: string } };
      if (j.contact?.id) return j.contact.id;
    }
  }
  // 2. Create
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ") || "Runner";
  const create = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      locationId,
      firstName,
      lastName,
      email,
      phone,
      tags: ["runner", "runner-report"],
      source: "Camauto Runner Portal",
    }),
  });
  const cj = (await create.json()) as {
    contact?: { id?: string };
    meta?: { contactId?: string };
  };
  const id = cj.contact?.id || cj.meta?.contactId;
  if (!id) {
    throw new Error(
      `GHL contact create failed [${create.status}]: ${JSON.stringify(cj)}`,
    );
  }
  return id;
}

export const pushRunnerReportToGhl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const token = process.env.GHL_PIT_TOKEN;
    const locationId = process.env.GHL_LOCATION_ID;
    if (!token) throw new Error("GHL_PIT_TOKEN is not configured");
    if (!locationId) throw new Error("GHL_LOCATION_ID is not configured");

    const contactId = await findOrCreateContact({
      token,
      locationId,
      name: data.runnerName,
      email: data.runnerEmail,
      phone: data.runnerPhone,
    });

    const noteRes = await fetch(
      `${GHL_BASE}/contacts/${contactId}/notes`,
      {
        method: "POST",
        headers: ghlHeaders(token),
        body: JSON.stringify({ body: buildNoteBody(data) }),
      },
    );
    if (!noteRes.ok) {
      const text = await noteRes.text();
      throw new Error(`GHL note create failed [${noteRes.status}]: ${text}`);
    }
    const noteJson = (await noteRes.json()) as { note?: { id?: string } };
    return { contactId, noteId: noteJson.note?.id ?? null };
  });