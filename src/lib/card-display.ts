import type { Driver } from "@/lib/mock/data";

export interface SavedCard {
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  expired: boolean;
}

export function brandLabel(brand?: string): string {
  if (!brand) return "Card";
  const map: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
    diners: "Diners Club",
    jcb: "JCB",
    unionpay: "UnionPay",
  };
  return map[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function isCardExpired(expMonth?: number, expYear?: number): boolean {
  if (!expMonth || !expYear) return false;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  if (expYear < curY) return true;
  if (expYear === curY && expMonth < curM) return true;
  return false;
}

export function getSavedCard(driver?: Driver | null): SavedCard | null {
  if (!driver) return null;
  if (!driver.stripePaymentMethodId || !driver.cardLast4) return null;
  return {
    brand: brandLabel(driver.cardBrand),
    last4: driver.cardLast4,
    expMonth: driver.cardExpMonth,
    expYear: driver.cardExpYear,
    expired: isCardExpired(driver.cardExpMonth, driver.cardExpYear),
  };
}
