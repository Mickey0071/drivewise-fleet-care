import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendRenewalLinkForRental } from "@/lib/renewal-link.server";

export const sendRenewalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; reminder?: boolean }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    return { rentalId: d.rentalId, reminder: !!d.reminder };
  })
  .handler(async ({ data, context }) => {
    return await sendRenewalLinkForRental(data.rentalId, data.reminder, context.userId);
  });
