import { useMemo } from "react";
import { AlertTriangle, Link2 } from "lucide-react";

/** The canonical public origin that server functions use to build shareable links. */
export const PUBLIC_APP_ORIGIN = "https://camautorentals.lovable.app";

/** True when an origin is a Lovable preview/sandbox/localhost URL (requires login). */
export function isPreviewOrigin(origin: string): boolean {
  if (!origin) return false;
  if (/localhost|127\.0\.0\.1/i.test(origin)) return true;
  if (/id-preview|--.*-dev\.lovable\.app|lovableproject\.com|sandbox/i.test(origin))
    return true;
  // Any lovable.app host that is not the production host is a preview.
  if (/\.lovable\.app/i.test(origin) && !origin.includes("camautorentals.lovable.app"))
    return true;
  return false;
}

/**
 * Small label that shows the exact public link an admin is about to send, so
 * they can verify it points at the production site (not a preview/login URL).
 *
 * `route` should start with "/" (e.g. "/verify-card/" or "/mechanic-job/[token]").
 */
export function SendLinkPreview({ route }: { route: string }) {
  const currentOrigin =
    typeof window !== "undefined" ? window.location.origin : PUBLIC_APP_ORIGIN;
  const onPreview = useMemo(() => isPreviewOrigin(currentOrigin), [currentOrigin]);
  const display = `${PUBLIC_APP_ORIGIN}${route.startsWith("/") ? route : `/${route}`}`.replace(
    /^https?:\/\//,
    "",
  );

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2">
        <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">Link to be sent</p>
          <p className="break-all font-mono text-xs text-foreground">{display}</p>
        </div>
      </div>
      {onPreview && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="text-xs">
            <strong>WARNING:</strong> You're on a preview URL. The recipient may get a link
            that requires login. Open the published site (
            <span className="font-mono">camautorentals.lovable.app</span>) and resend to be safe.
          </p>
        </div>
      )}
    </div>
  );
}