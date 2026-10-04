import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordFormVisit } from "@/lib/form-tracking.functions";

export const CONSENT_TEXT = "I agree to receive text/email offers from Camauto. Reply STOP to opt out.";

const KEY = "camauto_visitor_id";

export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

/** Logs one visit per page load for an online form (UTM, referrer, tracked link). */
export function useFormVisit(formName: string) {
  const record = useServerFn(recordFormVisit);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    try {
      const p = new URLSearchParams(window.location.search);
      const c = p.get("c");
      void record({
        data: {
          formName,
          visitorId: getVisitorId(),
          utmSource: p.get("utm_source"),
          utmMedium: p.get("utm_medium"),
          utmCampaign: p.get("utm_campaign"),
          utmContent: p.get("utm_content"),
          utmTerm: p.get("utm_term"),
          referrer: document.referrer || null,
          pageUrl: window.location.href.slice(0, 1000),
          trackingToken: p.get("mt"),
          campaignId: c && /^[0-9a-f-]{36}$/i.test(c) ? c : null,
        },
      }).catch(() => {});
    } catch {
      /* tracking must never break the form */
    }
  }, [formName, record]);
}
