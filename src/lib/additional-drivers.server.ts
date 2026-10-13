import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Row = { full_name: string | null; status: string; reviewed_at: string | null; revoked_at: string | null; addendum_pdf_url: string | null };

function authorizedOn(r: Row, date: string): boolean {
  const day = date.slice(0, 10);
  const approved = (r.reviewed_at || "").slice(0, 10);
  if (!approved || approved > day) return false;
  if (r.revoked_at && r.revoked_at.slice(0, 10) <= day) return false;
  return true;
}

/** Short-lived URLs for additional-driver addendum PDFs to merge into packets.
 *  date === undefined → currently approved drivers; otherwise drivers authorized on that date. */
export async function addendumPartsFor(rentalId: string | null | undefined, date?: string | null): Promise<Array<{ label: string; url: string | null }>> {
  if (!rentalId) return [];
  const { data: rows } = await supabaseAdmin
    .from("additional_drivers")
    .select("full_name, status, reviewed_at, revoked_at, addendum_pdf_url")
    .eq("rental_id", rentalId)
    .in("status", ["approved", "revoked"]);
  const list = ((rows ?? []) as Row[]).filter((r) =>
    date === undefined ? r.status === "approved" : date ? authorizedOn(r, date) : r.status === "approved",
  );
  return Promise.all(
    list.filter((r) => r.addendum_pdf_url).map(async (r) => {
      const { data } = await supabaseAdmin.storage.from("rental-signing").createSignedUrl(r.addendum_pdf_url!, 600);
      return { label: `Additional Driver Addendum - ${r.full_name ?? ""}`, url: data?.signedUrl ?? null };
    }),
  );
}
