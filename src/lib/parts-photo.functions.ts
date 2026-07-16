import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

export interface AdminPartExtraction {
  part_name: string | null;
  supplier: string | null;
  technician: string | null;
  part_cost: number | null;
  labor_cost: number | null;
  date: string | null; // YYYY-MM-DD
  notes: string | null;
  confidence: number; // 0-100
}

export interface MechanicPartRow {
  name: string;
  qty: number;
  price: number;
  labor: number;
}

export interface MechanicPartsExtraction {
  parts: MechanicPartRow[];
  notes: string | null;
  confidence: number;
}

function validateDataUrl(dataUrl: string) {
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid image. Use JPG, PNG, or WEBP.");
  const buffer = Buffer.from(m[3], "base64");
  if (buffer.byteLength > 10 * 1024 * 1024) throw new Error("File exceeds 10MB");
  return { contentType: m[1], buffer };
}

async function uploadTicket(buffer: Buffer, contentType: string) {
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabaseAdmin.storage.from("parts-tickets").upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: signed } = await supabaseAdmin.storage.from("parts-tickets").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  return signed?.signedUrl ?? null;
}

async function callGemini(dataUrl: string, systemPrompt: string, userText: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
  if (res.status === 429) throw new Error("AI is busy — please try again in a moment.");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[parts-photo] gateway ${res.status}: ${t.slice(0, 300)}`);
    throw new Error("Could not read the ticket. Fill in manually.");
  }
  const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
  let raw = json?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("Empty response from AI");
  raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error("[parts-photo] bad JSON:", raw.slice(0, 200));
    throw new Error("Could not read the ticket. Fill in manually.");
  }
}

const cleanStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cleanNum = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(/[$,]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Admin: analyze a parts receipt/invoice for the /admin/parts form. */
export const analyzePartsTicketAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dataUrl: string }) => {
    if (!d?.dataUrl) throw new Error("Missing image");
    return { dataUrl: d.dataUrl };
  })
  .handler(async ({ data }): Promise<{ photoUrl: string | null; extraction: AdminPartExtraction }> => {
    const { contentType, buffer } = validateDataUrl(data.dataUrl);
    const photoUrl = await uploadTicket(buffer, contentType);
    const parsed = await callGemini(
      data.dataUrl,
      'You extract fields from photos of auto-parts receipts, invoices, or handwritten shop tickets. Return ONLY compact JSON: {"part_name":string,"supplier":string,"technician":string,"part_cost":number,"labor_cost":number,"date":string,"notes":string,"confidence":number}. supplier = the store/vendor the part was bought from (e.g. AutoZone, NAPA, O\'Reilly). part_name = short description of the main part or, if multiple parts, a summary like "brake pads + rotors". part_cost = subtotal for parts in USD. labor_cost = labor charge in USD (0 if none). date = YYYY-MM-DD if visible, else empty string. technician = name of the mechanic/technician if written, else empty. notes = anything else relevant (line items list, invoice number, notes). confidence = 0-100 integer. Use empty string for unreadable text and 0 for unreadable numbers. No prose, no code fences.',
      "Extract the fields from this parts ticket.",
    );
    const extraction: AdminPartExtraction = {
      part_name: cleanStr(parsed.part_name) || null,
      supplier: cleanStr(parsed.supplier) || null,
      technician: cleanStr(parsed.technician) || null,
      part_cost: cleanNum(parsed.part_cost) || null,
      labor_cost: cleanNum(parsed.labor_cost) || null,
      date: (() => {
        const s = cleanStr(parsed.date);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
      })(),
      notes: cleanStr(parsed.notes) || null,
      confidence: Math.max(0, Math.min(100, Math.round(cleanNum(parsed.confidence)))),
    };
    return { photoUrl, extraction };
  });

/** Public: analyze a parts ticket for the mechanic checklist. Validated by job token. */
export const analyzePartsTicketMechanic = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; dataUrl: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    if (!d?.dataUrl) throw new Error("Missing image");
    return { token: d.token, dataUrl: d.dataUrl };
  })
  .handler(async ({ data }): Promise<{ photoUrl: string | null; extraction: MechanicPartsExtraction }> => {
    // Validate token maps to an active job.
    const { data: job } = await (supabaseAdmin as any)
      .from("mechanic_jobs")
      .select("id, status")
      .eq("token", data.token)
      .maybeSingle();
    if (!job) throw new Error("Invalid or expired link");
    if (job.status === "submitted") throw new Error("This job is already submitted");

    const { contentType, buffer } = validateDataUrl(data.dataUrl);
    const photoUrl = await uploadTicket(buffer, contentType);
    const parsed = await callGemini(
      data.dataUrl,
      'You extract line items from photos of auto-parts receipts, invoices, or shop tickets. Return ONLY compact JSON: {"parts":[{"name":string,"qty":number,"price":number,"labor":number}],"notes":string,"confidence":number}. Each part = one line item. name = the part description. qty = integer quantity (default 1). price = unit price in USD (0 if unreadable). labor = labor charge for that line in USD (0 if none or unclear). If there is one bulk labor line at the bottom, put it on the first part\'s labor and set the others to 0. notes = shop name, invoice number, or anything relevant. confidence = 0-100. No prose, no code fences.',
      "Extract the parts line items from this ticket.",
    );
    const rawParts = Array.isArray(parsed.parts) ? (parsed.parts as unknown[]) : [];
    const parts: MechanicPartRow[] = rawParts
      .map((p): MechanicPartRow => {
        const row = (p ?? {}) as Record<string, unknown>;
        const qty = Math.max(1, Math.floor(cleanNum(row.qty) || 1));
        return {
          name: cleanStr(row.name),
          qty,
          price: cleanNum(row.price),
          labor: cleanNum(row.labor),
        };
      })
      .filter((p) => p.name.length > 0)
      .slice(0, 25);
    return {
      photoUrl,
      extraction: {
        parts,
        notes: cleanStr(parsed.notes) || null,
        confidence: Math.max(0, Math.min(100, Math.round(cleanNum(parsed.confidence)))),
      },
    };
  });