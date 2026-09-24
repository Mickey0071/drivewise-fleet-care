import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MAX_BODY_BYTES = 32_768;
const sourceSchema = z.enum(["agency", "facebook", "manual", "direct"]);
const intakeSchema = z.object({
  name: z.string().trim().min(2, "name is required").max(120),
  phone: z.string().trim().min(7, "phone is required").max(40),
  email: z.string().trim().email().max(200).optional(),
  drives_rideshare: z.boolean().optional(),
  accepts_deposit: z.boolean().optional(),
  accepts_daily_rate: z.boolean().optional(),
  preferred_start: z.string().trim().max(100).optional(),
  src: sourceSchema.default("agency"),
  campaign: z.string().trim().max(160).optional(),
}).strict();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/waitlist-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeWaitlistIntake, consumeIntakeRateLimit, normalizeIntakePhone, processWaitlistIntake, titleCaseName } =
          await import("@/lib/waitlist-intake.server");
        const key = request.headers.get("x-waitlist-key");
        if (!authorizeWaitlistIntake(key)) return json({ ok: false, error: "Unauthorized" }, 401);
        if (!key || !(await consumeIntakeRateLimit(key))) return json({ ok: false, error: "Too many requests" }, 429);
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: "Request body is too large" }, 413);

        let raw: unknown;
        try {
          const text = await request.text();
          if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: "Request body is too large" }, 413);
          raw = JSON.parse(text);
        } catch {
          return json({ ok: false, error: "Body must be valid JSON" }, 400);
        }
        const parsed = intakeSchema.safeParse(raw);
        if (!parsed.success) {
          return json({ ok: false, error: "Invalid submission", details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) }, 400);
        }
        try {
          normalizeIntakePhone(parsed.data.phone);
          const result = await processWaitlistIntake({
            ...parsed.data,
            name: titleCaseName(parsed.data.name),
            raw: raw as Record<string, unknown>,
          });
          return json({ ok: true, result: result.created ? "created" : "updated", tier: result.tier, status: result.status, sms_sent: result.smsSent });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not process submission";
          const isPhoneError = message.startsWith("phone must");
          console.error("[waitlist-intake] request failed", isPhoneError ? message : error);
          return json({ ok: false, error: isPhoneError ? message : "Could not process submission" }, isPhoneError ? 400 : 500);
        }
      },
    },
  },
});