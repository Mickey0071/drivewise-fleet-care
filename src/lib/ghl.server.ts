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
  if (!phone) {
    console.warn("GHL sendSms skipped: no phone");
    return;
  }
  try {
    const contactId = await upsertContact(phone, name);
    await ghlFetch("/conversations/messages", {
      type: "SMS",
      contactId,
      message,
    });
  } catch (e) {
    // Don't fail the webhook on SMS errors — just log.
    console.error("GHL sendSms failed:", e);
  }
}