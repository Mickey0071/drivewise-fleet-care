import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ViolationExtraction {
  license_plate: string | null;
  violation_date: string | null; // MM/DD/YYYY
  location: string | null;
  toll_amount: number | null;
  fee_amount: number | null;
  total_amount: number | null;
  violation_type: "toll" | "parking" | "traffic" | "damage" | null;
  confidence: number; // 0-100
}

export const analyzeViolationPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dataUrl: string }) => {
    if (!input.dataUrl || !input.dataUrl.startsWith("data:image/")) {
      throw new Error("Invalid image data URL");
    }
    return { dataUrl: input.dataUrl };
  })
  .handler(async ({ data }): Promise<{
    photoUrl: string;
    extraction: ViolationExtraction;
  }> => {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data.dataUrl);
    if (!m) throw new Error("Invalid data URL");
    const contentType = m[1];
    const buffer = Buffer.from(m[2], "base64");
    if (buffer.byteLength > 10 * 1024 * 1024) throw new Error("File exceeds 10MB");
    const ext = contentType.includes("png") ? "png"
      : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
      : contentType.includes("webp") ? "webp" : "bin";
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("violation-photos")
      .upload(path, buffer, { contentType, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("violation-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    if (sErr || !signed?.signedUrl) throw new Error(`Sign URL failed: ${sErr?.message ?? "unknown"}`);

    const apiKey = process.env.LOVABLE_API_KEY;
    let extraction: ViolationExtraction = {
      license_plate: null,
      violation_date: null,
      location: null,
      toll_amount: null,
      fee_amount: null,
      total_amount: null,
      violation_type: null,
      confidence: 0,
    };
    if (!apiKey) {
      console.error("[violation-photo] LOVABLE_API_KEY missing");
      return { photoUrl: signed.signedUrl, extraction };
    }

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                'You read photos of toll bills, parking tickets, traffic citations, and vehicle damage notices. Return ONLY a compact JSON object with this exact shape: {"license_plate":string,"violation_date":string,"location":string,"toll_amount":number,"fee_amount":number,"total_amount":number,"violation_type":"toll"|"parking"|"traffic"|"damage","confidence":number}. Prioritize reading the license_plate accurately above all else. license_plate format: "ST ABC1234" (state abbrev + plate) or just plate if no state. violation_date format: MM/DD/YYYY. location: the toll plaza, street, or place of the violation (empty string if not shown). Amounts in USD decimal numbers (use 0 if not visible). confidence: 0-100 integer reflecting how clearly you could read the license plate and date. Use empty string for unreadable text fields and 0 for unreadable numbers. No prose, no code fences.',
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract violation details from this image." },
                { type: "image_url", image_url: { url: data.dataUrl } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error(`[violation-photo] gateway ${res.status}: ${t.slice(0, 300)}`);
        return { photoUrl: signed.signedUrl, extraction };
      }
      const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
      let raw = json?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") return { photoUrl: signed.signedUrl, extraction };
      raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(raw); } catch {
        console.error("[violation-photo] failed to parse model output:", raw.slice(0, 200));
        return { photoUrl: signed.signedUrl, extraction };
      }
      const cleanStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const cleanNum = (v: unknown) => {
        const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
        return Number.isFinite(n) ? n : 0;
      };
      const type = cleanStr(parsed.violation_type).toLowerCase();
      extraction = {
        license_plate: cleanStr(parsed.license_plate) || null,
        violation_date: cleanStr(parsed.violation_date) || null,
        location: cleanStr(parsed.location) || null,
        toll_amount: cleanNum(parsed.toll_amount) || null,
        fee_amount: cleanNum(parsed.fee_amount) || null,
        total_amount: cleanNum(parsed.total_amount) || null,
        violation_type: (["toll", "parking", "traffic", "damage"].includes(type)
          ? (type as "toll" | "parking" | "traffic" | "damage")
          : null),
        confidence: Math.max(0, Math.min(100, Math.round(cleanNum(parsed.confidence)))),
      };
    } catch (e) {
      console.error("[violation-photo] analysis failed:", e);
    }

    return { photoUrl: signed.signedUrl, extraction };
  });