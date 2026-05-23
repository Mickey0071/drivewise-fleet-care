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