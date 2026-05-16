const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function getEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not configured`);
  return v;
}

async function ghlFetch(path: string, body: unknown) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getEnv("GHL_PIT_TOKEN")}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

function toE164(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

async function upsertContact(phone: string, name?: string | null): Promise<string> {
  const [firstName, ...rest] = (name || "").trim().split(/\s+/);
  const payload: Record<string, unknown> = {
    locationId: getEnv("GHL_LOCATION_ID"),
    phone,
  };
  if (firstName) payload.firstName = firstName;
  if (rest.length) payload.lastName = rest.join(" ");
  const data = await ghlFetch("/contacts/upsert", payload);
  const id = data?.contact?.id || data?.id;
  if (!id) throw new Error(`GHL upsert returned no contact id: ${JSON.stringify(data)}`);
  return id as string;
}

export async function sendSms(phone: string, message: string, name?: string | null) {
  const normalized = toE164(phone);
  if (!normalized) {
    throw new Error("No phone number on file");
  }
  const contactId = await upsertContact(normalized, name);
  await ghlFetch("/conversations/messages", {
    type: "SMS",
    contactId,
    message,
  });
}