export type RenewalStatusKind = "LINK_SENT" | "DUE_TODAY" | "DUE_TOMORROW" | "OVERDUE";
export type RenewalColor = "success" | "warning" | "accent" | "danger";

export interface RenewalStatus {
  status: RenewalStatusKind;
  badgeLabel: string;
  color: RenewalColor;
}

export interface RenewalStatusInput {
  extensionDueDate?: string | null;
  returnDueDate?: string | null;
  renewalLinkSent?: boolean | null;
}

/** Renewal badge state for a reservation card. Returns null when nothing to show. */
export function calculateRenewalStatus(rental: RenewalStatusInput): RenewalStatus | null {
  const dueDate = rental.extensionDueDate || rental.returnDueDate;
  if (!dueDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  due.setHours(0, 0, 0, 0);

  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / 86400000);

  if (rental.renewalLinkSent) {
    return { status: "LINK_SENT", badgeLabel: "LINK SENT FOR RENEWAL", color: "success" };
  }
  if (daysUntilDue === 0) {
    return { status: "DUE_TODAY", badgeLabel: "DUE FOR RENEWAL TODAY", color: "warning" };
  }
  if (daysUntilDue === 1) {
    return { status: "DUE_TOMORROW", badgeLabel: "DUE FOR RENEWAL TOMORROW", color: "accent" };
  }
  if (daysUntilDue < 0) {
    return { status: "OVERDUE", badgeLabel: "OVERDUE - RENEWAL", color: "danger" };
  }
  return null;
}

export const RENEWAL_BADGE_CLASS: Record<RenewalColor, string> = {
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
  accent: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  danger: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};
