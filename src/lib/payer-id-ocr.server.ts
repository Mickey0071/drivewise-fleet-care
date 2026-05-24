import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Extract the full legal name printed on a US driver's license / ID photo
 * using the Lovable AI gateway (Gemini vision). Returns null if no name
 * can be confidently read.
 */
export async function extractNameFromIdImage(imageDataUrl: string): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[payer-id-ocr] LOVABLE_API_KEY is not configured");
    return null;
  }
  if (!imageDataUrl.startsWith("data:image/")) {
    console.error("[payer-id-ocr] invalid data URL");
    return null;
  }

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
            "You read US driver's licenses and government IDs. Return ONLY the full legal name printed on the ID (first middle last), with no extra text, no labels, no quotes. If you cannot read a name with confidence, return exactly: UNKNOWN",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "What is the full name on this ID?" },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[payer-id-ocr] gateway ${res.status}: ${t.slice(0, 200)}`);
    return null;
  }
  const json = await res.json().catch(() => null) as any;
  const raw = json?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/^["']|["']$/g, "");
  if (!name || /^unknown$/i.test(name) || name.length > 120) return null;
  return name;
}

/**
 * Extract the residential address printed on a US driver's license / ID
 * photo. Returns a structured object with parts, plus a single-line
 * formatted string. Returns null if no address can be read confidently.
 */
export async function extractAddressFromIdImage(imageDataUrl: string): Promise<{
  formatted: string;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
} | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[payer-id-ocr] LOVABLE_API_KEY is not configured");
    return null;
  }
  if (!imageDataUrl.startsWith("data:image/")) return null;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You read US driver's licenses and government IDs. Return ONLY a compact JSON object with the holder's residential address in this exact shape: {\"streetAddress\":string,\"city\":string,\"state\":string,\"zipCode\":string}. Use the 2-letter state abbreviation. If a field can't be read, use an empty string. If no address is visible at all, return {\"streetAddress\":\"\",\"city\":\"\",\"state\":\"\",\"zipCode\":\"\"}. No prose, no code fences.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the address from this ID." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[payer-id-ocr address] gateway ${res.status}: ${t.slice(0, 200)}`);
    return null;
  }
  const json = await res.json().catch(() => null) as any;
  let raw = json?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return null;
  raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const streetAddress = clean(parsed.streetAddress);
  const city = clean(parsed.city);
  const state = clean(parsed.state).toUpperCase().slice(0, 2);
  const zipCode = clean(parsed.zipCode);
  if (!streetAddress && !city && !state && !zipCode) return null;
  const cityStateZip = [city, [state, zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const formatted = [streetAddress, cityStateZip].filter(Boolean).join(", ");
  return {
    formatted,
    streetAddress: streetAddress || null,
    city: city || null,
    state: state || null,
    zipCode: zipCode || null,
  };
}

/**
 * Upload a payer-ID data URL to the rental-signing bucket and return a
 * long-lived signed URL.
 */
export async function uploadPayerIdImage(rentalId: string, dataUrl: string): Promise<string> {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("File exceeds 8MB");
  const ext = contentType.includes("png") ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("webp") ? "webp" : "bin";
  const path = `${rentalId}/payer-id-${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from("rental-signing")
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data, error: signErr } = await supabaseAdmin.storage
    .from("rental-signing")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr || !data?.signedUrl) throw new Error(`Sign URL failed: ${signErr?.message ?? "unknown"}`);
  return data.signedUrl;
}

/**
 * Single-pass OCR of a US driver's license: full name, DL number, state,
 * expiration date, date of birth, and residential address. Returns null
 * if nothing readable. Date fields are normalized to YYYY-MM-DD when
 * possible.
 */
export async function extractLicenseFieldsFromImage(imageDataUrl: string): Promise<{
  fullName: string | null;
  licenseNumber: string | null;
  dlState: string | null;
  licenseExpiry: string | null; // YYYY-MM-DD
  dateOfBirth: string | null; // YYYY-MM-DD
  address: {
    formatted: string;
    streetAddress: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  } | null;
} | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[license-ocr] LOVABLE_API_KEY is not configured");
    return null;
  }
  if (!imageDataUrl.startsWith("data:image/")) return null;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            'You read US driver\'s licenses. Return ONLY a compact JSON object with this exact shape: {"fullName":string,"licenseNumber":string,"dlState":string,"licenseExpiry":string,"dateOfBirth":string,"streetAddress":string,"city":string,"state":string,"zipCode":string}. Use ISO YYYY-MM-DD for dates. Use the 2-letter abbreviation for dlState and state. Use empty string for any field you cannot read confidently. No prose, no code fences.',
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the license fields from this ID." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[license-ocr] gateway ${res.status}: ${t.slice(0, 200)}`);
    return null;
  }
  const json = (await res.json().catch(() => null)) as any;
  let raw = json?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return null;
  raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { return null; }

  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const normDate = (v: string): string | null => {
    if (!v) return null;
    // already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    // MM/DD/YYYY or M/D/YYYY
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(v);
    if (m) {
      let [, mo, d, y] = m;
      if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return null;
  };

  const fullName = clean(parsed.fullName) || null;
  const licenseNumber = clean(parsed.licenseNumber) || null;
  const dlState = clean(parsed.dlState).toUpperCase().slice(0, 2) || null;
  const licenseExpiry = normDate(clean(parsed.licenseExpiry));
  const dateOfBirth = normDate(clean(parsed.dateOfBirth));

  const streetAddress = clean(parsed.streetAddress);
  const city = clean(parsed.city);
  const state = clean(parsed.state).toUpperCase().slice(0, 2);
  const zipCode = clean(parsed.zipCode);
  const hasAddr = !!(streetAddress || city || state || zipCode);
  const cityStateZip = [city, [state, zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const formatted = [streetAddress, cityStateZip].filter(Boolean).join(", ");
  const address = hasAddr
    ? {
        formatted,
        streetAddress: streetAddress || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
      }
    : null;

  const anything = fullName || licenseNumber || dlState || licenseExpiry || dateOfBirth || address;
  if (!anything) return null;

  return { fullName, licenseNumber, dlState, licenseExpiry, dateOfBirth, address };
}