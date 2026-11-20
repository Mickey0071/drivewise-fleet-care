import { normalizeAgreementPdf } from "@/lib/one-page-agreement";

/** Always fit saved agreements at read time; never overwrite original evidence. */
export async function agreementObjectUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load rental agreement (HTTP ${response.status})`);
  const bytes = await normalizeAgreementPdf(new Uint8Array(await response.arrayBuffer()));
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
}

export async function openOnePageAgreement(url: string): Promise<void> {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow pop-ups to open the rental agreement");
  popup.opener = null;
  try {
    const fitted = await agreementObjectUrl(url);
    popup.location.replace(fitted);
    window.setTimeout(() => URL.revokeObjectURL(fitted), 300_000);
  } catch (error) {
    popup.close();
    throw error;
  }
}