import { sendSms, sendEmail } from "./ghl.server";
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

const CONTACT_PHONE = "1-866-625-5550";
const BRAND_COLOR = "#2db84b";

export interface EmailDetail {
  label: string;
  value: string;
}

export interface RenterNotifyInput {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  /** SMS body (sent as-is). */
  sms: string;
  /** Email subject. */
  emailSubject: string;
  /** Big heading at top of the email body. */
  emailHeading: string;
  /** Lead paragraph (plain text or simple HTML). */
  emailIntro: string;
  /** Optional call-to-action button. */
  emailCta?: { label: string; url: string } | null;
  /** Optional key/value details rendered as a table (rate, dates, amounts…). */
  emailDetails?: EmailDetail[];
  /** Optional small note rendered under the CTA. */
  emailFootnote?: string;
  /** Optional PDF/file attachments (URLs, forwarded to GHL). */
  emailAttachments?: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(input: RenterNotifyInput): string {
  const name = input.name ? escapeHtml(input.name) : null;
  const greeting = name ? `Hi ${name},` : "Hello,";
  const detailsHtml =
    input.emailDetails && input.emailDetails.length
      ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0"
            style="border-collapse:collapse;width:100%;margin:18px 0;
                   background:#f7f8fa;border-radius:8px;">
          <tbody>
            ${input.emailDetails
              .map(
                (d) => `
              <tr>
                <td style="padding:10px 14px;color:#555;font-size:13px;
                           border-bottom:1px solid #eaecef;width:40%;">
                  ${escapeHtml(d.label)}
                </td>
                <td style="padding:10px 14px;color:#111;font-size:14px;
                           font-weight:600;border-bottom:1px solid #eaecef;">
                  ${escapeHtml(d.value)}
                </td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>`
      : "";
  const ctaHtml = input.emailCta
    ? `<p style="margin:24px 0;">
        <a href="${input.emailCta.url}"
           style="background:${BRAND_COLOR};color:#fff;padding:12px 22px;
                  border-radius:6px;text-decoration:none;font-weight:600;
                  display:inline-block;">
          ${escapeHtml(input.emailCta.label)}
        </a>
      </p>`
    : "";
  const footnoteHtml = input.emailFootnote
    ? `<p style="color:#666;font-size:13px;margin:12px 0 0;">
         ${escapeHtml(input.emailFootnote)}
       </p>`
    : "";

  return `
<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;
            max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
  <div style="text-align:center;padding:12px 0 18px;border-bottom:2px solid ${BRAND_COLOR};">
    <img src="${CAMAUTO_LOGO_BASE64}" alt="Camauto Rentals"
         style="max-height:60px;height:auto;width:auto;display:inline-block;" />
  </div>
  <h2 style="font-size:20px;margin:24px 0 12px;color:#111;">
    ${escapeHtml(input.emailHeading)}
  </h2>
  <p style="font-size:14px;color:#333;margin:0 0 14px;">${greeting}</p>
  <p style="font-size:14px;color:#333;margin:0 0 8px;">${input.emailIntro}</p>
  ${detailsHtml}
  ${ctaHtml}
  ${footnoteHtml}
  <hr style="border:none;border-top:1px solid #eaecef;margin:32px 0 16px;" />
  <div style="font-size:12px;color:#888;line-height:1.6;">
    <strong style="color:#444;">Camauto Rentals</strong><br />
    Questions? Call us at
    <a href="tel:18666255550" style="color:${BRAND_COLOR};text-decoration:none;">
      ${CONTACT_PHONE}
    </a><br />
    416 Sicklerville Road, Sicklerville, NJ 08081
  </div>
</div>`;
}

/**
 * Send a renter-facing notice via SMS and (when an email is on file) a
 * branded HTML email at the same time. Never throws — returns per-channel
 * success/error info so the caller can keep going if one channel fails.
 */
export async function notifyRenter(
  input: RenterNotifyInput,
): Promise<{ smsSent: boolean; emailSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let smsSent = false;
  let emailSent = false;

  if (input.phone) {
    try {
      await sendSms(input.phone, input.sms, input.name ?? null);
      smsSent = true;
    } catch (e) {
      errors.push(`SMS failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const validEmail =
    input.email &&
    input.email.includes("@") &&
    !input.email.endsWith("@camauto.local");
  if (validEmail) {
    try {
      await sendEmail(input.email!, input.emailSubject, buildHtml(input), {
        name: input.name ?? null,
        phone: input.phone ?? null,
        attachments: input.emailAttachments,
      });
      emailSent = true;
    } catch (e) {
      errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { smsSent, emailSent, errors };
}