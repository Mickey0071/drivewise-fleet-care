import { normalizePhone } from "@/lib/ghl.server";

export function titleCaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

export function normalizeIntakePhone(value: string): string {
  const normalized = normalizePhone(value);
  if (!/^\+1\d{10}$/.test(normalized)) throw new Error("phone must be a valid 10-digit US number");
  return normalized;
}