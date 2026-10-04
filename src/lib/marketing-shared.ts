/** Browser-safe marketing helpers shared by the Marketing page and the server sender. */

export const COMPANY_NAME = "Camauto";
export const STOP_FOOTER = "Reply STOP to opt out.";

export type LeadSource = "online_form" | "funnel" | "manual_entry" | "waitlist" | "csv_import" | "other";
export type ConsentStatus = "unknown" | "opted_in" | "opted_out";

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  online_form: "Online form",
  funnel: "Funnel",
  manual_entry: "Manual entry",
  waitlist: "Waitlist",
  csv_import: "CSV import",
  other: "Other",
};

export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  unknown: "Unknown",
  opted_in: "Opted in",
  opted_out: "Opted out",
};

export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "vehicle",
  "plate",
  "balance_due",
  "company_name",
  "link",
] as const;

export const TEMPLATE_CATEGORIES = ["Promo", "Payment reminder", "Waitlist vehicle available", "Referral ask", "Other"];

export interface AudienceCustomer {
  id: string; // driver id, or "wl:<uuid>" for waitlist entries not yet converted
  kind: "driver" | "waitlist";
  name: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  leadSource: LeadSource;
  sourceDetail: string | null;
  consentStatus: ConsentStatus;
  consentNote: string | null;
  consentAt: string | null;
  doNotText: boolean;
  isCurrent: boolean;
  isPast: boolean;
  isWaitlist: boolean;
  visitedForm: boolean;
  visitedNotSubmitted: boolean;
  vehicle: string | null;
  plate: string | null;
  balanceDue: number;
}

export function hasPhone(c: { phone: string | null }) {
  return (c.phone ?? "").replace(/\D/g, "").length >= 10;
}

export function isExcluded(c: { consentStatus: ConsentStatus; doNotText: boolean }) {
  return c.consentStatus === "opted_out" || c.doNotText;
}

export function mergeVars(c: AudienceCustomer, link: string): Record<string, string> {
  return {
    first_name: c.firstName || c.name.split(" ")[0] || "there",
    last_name: c.lastName || "",
    vehicle: c.vehicle || "your vehicle",
    plate: c.plate || "",
    balance_due: `$${c.balanceDue.toFixed(2)}`,
    company_name: COMPANY_NAME,
    link,
  };
}

export function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
}

export function withStopFooter(text: string) {
  const t = text.trim();
  if (/reply stop to opt out\.?$/i.test(t)) return t;
  return `${t}\n${STOP_FOOTER}`;
}

const GSM = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

export function smsStats(text: string) {
  const gsm = GSM.test(text);
  const len = gsm ? [...text].reduce((n, ch) => n + ("^{}\\[~]|€".includes(ch) ? 2 : 1), 0) : [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi);
  return { length: len, segments, encoding: gsm ? "GSM" : "Unicode" };
}

export interface AudienceFilters {
  recentMode: "none" | "count" | "days";
  recentCount: number;
  recentDays: number;
  statuses: Array<"current" | "past" | "waitlist">;
  leadSources: LeadSource[];
  visit: "any" | "visited" | "visited_not_submitted";
  hasPhoneOnly: boolean;
}

export const EMPTY_FILTERS: AudienceFilters = {
  recentMode: "none",
  recentCount: 25,
  recentDays: 30,
  statuses: [],
  leadSources: [],
  visit: "any",
  hasPhoneOnly: true,
};

export function filtersActive(f: AudienceFilters) {
  return f.recentMode !== "none" || f.statuses.length > 0 || f.leadSources.length > 0 || f.visit !== "any";
}

export function applyFilters(list: AudienceCustomer[], f: AudienceFilters): AudienceCustomer[] {
  let out = list.filter((c) => {
    if (f.hasPhoneOnly && !hasPhone(c)) return false;
    if (f.statuses.length) {
      const ok =
        (f.statuses.includes("current") && c.isCurrent) ||
        (f.statuses.includes("past") && c.isPast) ||
        (f.statuses.includes("waitlist") && c.isWaitlist);
      if (!ok) return false;
    }
    if (f.leadSources.length && !f.leadSources.includes(c.leadSource)) return false;
    if (f.visit === "visited" && !c.visitedForm) return false;
    if (f.visit === "visited_not_submitted" && !c.visitedNotSubmitted) return false;
    return true;
  });
  if (f.recentMode === "days") {
    const cutoff = Date.now() - f.recentDays * 86400000;
    out = out.filter((c) => new Date(c.createdAt).getTime() >= cutoff);
  }
  out = [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (f.recentMode === "count") out = out.slice(0, Math.max(1, f.recentCount));
  return out;
}
