## Diagnosis

The task SMS flow is currently blocking task creation because `adminCreateTask` directly awaits `sendSms(...)`. If the GHL fetch hangs, the server function never returns, so the UI stays on Loading.

### Actual `adminCreateTask` SMS code

```ts
import { sendSms } from "@/lib/ghl.server";

// ...

// Build & send SMS
let smsStatus: "sent" | "skipped_no_phone" | "failed" = "skipped_no_phone";
let smsError: string | null = null;
if (data.notify_sms && runner?.phone) {
  const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
  const lines = [
    `Camauto Task: ${taskTypeLabel(data.task_type)}`,
    vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
    data.description ? data.description : null,
    data.address ? `Address: ${data.address}` : null,
    data.due_date ? `Due: ${data.due_date}` : null,
    `Open: ${origin}/my-tasks/${id}`,
  ].filter(Boolean) as string[];
  try {
    await sendSms(runner.phone, lines.join("\n"), runnerName);
    smsStatus = "sent";
  } catch (e) {
    smsStatus = "failed";
    smsError = e instanceof Error ? e.message : "SMS failed";
  }
}

return { task_id: created.id, runner_name: runnerName, sms_status: smsStatus, sms_error: smsError };
```

### Actual `sendSms` code from `src/lib/ghl.server.ts`

```ts
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
      Authorization: `Bearer ${getEnv("ghlPitToken")}`,
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

export async function sendSms(phone: string, message: string, name?: string | null) {
  const normalized = toE164(phone);
  if (!normalized) {
    console.error("[sms] no phone on file");
    throw new Error("No phone number on file");
  }
  const masked = maskPhone(normalized);
  try {
    const contactId = await upsertContact(normalized, name);
    await ghlFetch("/conversations/messages", {
      type: "SMS",
      contactId,
      message,
    });
    console.log(`[sms] sent ok phone=${masked}`);
  } catch (e) {
    console.error(`[sms] failed phone=${masked}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}
```

### Secrets/env check

The code does **not** use `GHL_API_KEY`. It uses:

- `ghlPitToken`: set
- `ghlLocationId`: set
- `GHL_PIT_TOKEN`: set
- `GHL_LOCATION_ID`: set
- `GHL_API_KEY`: missing

So `GHL_API_KEY` missing is not itself the bug, because this project’s GHL code is wired to `ghlPitToken` and `ghlLocationId`.

### Is GHL actually working in this project?

Answer: **yes, likely working**.

Evidence:

- `sendSms` is used by multiple existing features: vehicle photo share, payment links, rental SMS, renter chat, inspections, signing, and share-rental flows.
- Production/preview logs from the last hour include:

```text
[sms] sent ok phone=***5946
```

So this is not just unused scaffolding. The bug is more likely that the new task flow is synchronously waiting on SMS, and the GHL fetch has no timeout.

### Does `sendSms` have a fetch timeout?

No. `ghlFetch` and `ghlGet` call `fetch(...)` without `AbortController`, so if GHL stalls, task creation can stall indefinitely.

## Implementation plan

1. Update `src/lib/ghl.server.ts`
   - Add a shared timeout helper using `AbortController`.
   - Apply it to both `ghlFetch` and `ghlGet`.
   - Use a short timeout, e.g. 12–15 seconds.
   - Return a clear error like `GHL /conversations/messages timed out after 12000ms`.

2. Update `src/lib/tasks.functions.ts`
   - Keep task insertion first.
   - Build the SMS message after the task is inserted.
   - Fire SMS in a background/best-effort promise and do **not** await it before returning.
   - Log SMS success/failure server-side with task id and masked phone.
   - Return immediately after insert with something like:

```ts
return {
  task_id: created.id,
  runner_name: runnerName,
  sms_status: data.notify_sms && runner?.phone ? "queued" : "skipped_no_phone",
  sms_error: null,
};
```

3. Preserve existing behavior for no-phone runners
   - If `notify_sms` is true but there is no phone, return `skipped_no_phone` immediately.
   - Do not block task creation.

4. Verification
   - Re-run the relevant TypeScript/build check through the normal harness.
   - Confirm the code no longer awaits `sendSms` inside `adminCreateTask`.
   - Confirm all GHL fetch calls now have timeout coverage.
   - Use server logs after a test task send to confirm either `[task sms] sent` or `[task sms] failed`, while the UI returns success either way.

## Expected result

Admin task creation will no longer hang on Loading because database insert succeeds and returns immediately. SMS becomes best-effort: it can succeed, fail, or time out without blocking the New Task modal.