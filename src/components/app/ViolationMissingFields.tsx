import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { ViolationRow } from "@/lib/violations.functions";
import {
  updateRenterInfoForViolation,
  setViolationReference,
} from "@/lib/violations.functions";

/** Fields the mail packet expects to have populated. */
export type FieldKey =
  | "renterName"
  | "renterAddress"
  | "renterPhone"
  | "licenseNumber"
  | "ezpassRef"
  | "rentalPeriod"
  | "signedAgreement";

export const FIELD_LABELS: Record<FieldKey, string> = {
  renterName: "Renter name",
  renterAddress: "Renter address",
  renterPhone: "Renter phone",
  licenseNumber: "Driver license #",
  ezpassRef: "EZPass ref #",
  rentalPeriod: "Rental period dates",
  signedAgreement: "Signed agreement",
};

export const ALL_FIELDS: FieldKey[] = [
  "renterName",
  "renterAddress",
  "renterPhone",
  "licenseNumber",
  "ezpassRef",
  "rentalPeriod",
  "signedAgreement",
];

/** Compute which packet fields are present on a violation row. */
export function fieldStatus(v: ViolationRow): Record<FieldKey, boolean> {
  const has = (s: string | null | undefined) => Boolean(s && String(s).trim());
  return {
    renterName: has(v.driver_name),
    renterAddress: has(v.driver_address),
    renterPhone: has(v.driver_phone),
    licenseNumber: has(v.driver_license_number),
    ezpassRef: has(v.reference_number),
    rentalPeriod: has(v.rental_start) && has(v.rental_end),
    signedAgreement: Boolean(v.agreement_on_file),
  };
}

export function missingFieldsFor(v: ViolationRow): FieldKey[] {
  const s = fieldStatus(v);
  return ALL_FIELDS.filter((k) => !s[k]);
}

/** Compact ✅/⚠️ checklist rendered on each Matched-tab card. */
export function FieldChecklist({ v }: { v: ViolationRow }) {
  const s = fieldStatus(v);
  return (
    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] leading-snug">
      {ALL_FIELDS.map((k) => (
        <div
          key={k}
          className={s[k] ? "text-emerald-600" : "text-amber-600"}
          title={s[k] ? "On file" : "Missing"}
        >
          {s[k] ? "✅" : "⚠️"} {FIELD_LABELS[k]}
        </div>
      ))}
    </div>
  );
}

export function ReadinessBadge({ v }: { v: ViolationRow }) {
  const missing = missingFieldsFor(v);
  if (missing.length === 0) {
    return (
      <Badge className="border-emerald-300 bg-emerald-50 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
        Ready to mail
      </Badge>
    );
  }
  return (
    <Badge className="border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-700 hover:bg-amber-50">
      {missing.length} missing
    </Badge>
  );
}

/** Slide-in panel that shows only the currently-missing fields as inputs. */
export function MissingFieldsSheet({
  violation,
  onClose,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateRenterInfoForViolation);
  const refFn = useServerFn(setViolationReference);

  const missing = useMemo(
    () => (violation ? missingFieldsFor(violation) : []),
    [violation],
  );

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Reset the form whenever a new violation is opened.
  const key = violation?.id ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (key !== lastKey) {
    setLastKey(key);
    setForm({});
  }

  if (!violation) {
    return (
      <Sheet open={false} onOpenChange={(o) => (!o ? onClose() : null)}>
        <SheetContent />
      </Sheet>
    );
  }

  const open = Boolean(violation);
  const promptable = missing.filter(
    (k) => k !== "signedAgreement" && k !== "rentalPeriod",
  );

  const save = async () => {
    if (!violation) return;
    setBusy(true);
    try {
      const payload = {
        violationId: violation.id,
        fullName: form.renterName || undefined,
        address: form.renterAddress || undefined,
        phone: form.renterPhone || undefined,
        licenseNumber: form.licenseNumber || undefined,
        email: form.renterEmail || undefined,
      };
      const hasAny =
        payload.fullName ||
        payload.address ||
        payload.phone ||
        payload.licenseNumber ||
        payload.email;
      if (hasAny) {
        await updateFn({ data: payload });
      }
      if (form.ezpassRef && form.ezpassRef.trim()) {
        await refFn({
          data: { id: violation.id, referenceNumber: form.ezpassRef.trim() },
        });
      }
      toast.success("Renter info updated");
      qc.invalidateQueries({ queryKey: ["violations"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Fill missing info</SheetTitle>
          <SheetDescription>
            {violation.driver_name || "Unknown renter"} ·{" "}
            {violation.license_plate || "no plate"}
          </SheetDescription>
        </SheetHeader>

        {missing.length === 0 ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            ✅ All packet fields are on file. Ready to mail.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {promptable.map((k) => {
              const label = FIELD_LABELS[k];
              const inputKey =
                k === "ezpassRef"
                  ? "ezpassRef"
                  : k === "renterName"
                    ? "renterName"
                    : k === "renterAddress"
                      ? "renterAddress"
                      : k === "renterPhone"
                        ? "renterPhone"
                        : "licenseNumber";
              return (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Input
                    value={form[inputKey] ?? ""}
                    onChange={(e) => setField(inputKey, e.target.value)}
                    placeholder={
                      k === "renterAddress"
                        ? "123 Main St, Newark, NJ 07102"
                        : k === "ezpassRef"
                          ? "EZPass reference number"
                          : ""
                    }
                  />
                </div>
              );
            })}

            {missing.includes("signedAgreement") && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                ⚠️ No signed agreement on file. Send a retroactive signing link
                from the row's actions to capture one — packets still download.
              </div>
            )}
            {missing.includes("rentalPeriod") && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                ⚠️ Rental period dates missing. Match this violation to a
                rental (or edit the rental) to fill these in.
              </div>
            )}
          </div>
        )}

        <SheetFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || promptable.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save + update packet
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Fleet-wide counts across matched rows, with click-to-filter behaviour. */
export function FleetMissingSummary({
  rows,
  activeField,
  onPickField,
}: {
  rows: ViolationRow[];
  activeField: FieldKey | null;
  onPickField: (k: FieldKey | null) => void;
}) {
  const counts = useMemo(() => {
    const c: Record<FieldKey, number> = {
      renterName: 0,
      renterAddress: 0,
      renterPhone: 0,
      licenseNumber: 0,
      ezpassRef: 0,
      rentalPeriod: 0,
      signedAgreement: 0,
    };
    for (const r of rows) {
      const s = fieldStatus(r);
      for (const k of ALL_FIELDS) if (!s[k]) c[k]++;
    }
    return c;
  }, [rows]);

  const anyMissing = ALL_FIELDS.some((k) => counts[k] > 0);
  if (!anyMissing && !activeField) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-wrap items-center gap-2 p-3 text-xs">
        <span className="font-semibold text-muted-foreground">
          Fleet-wide missing:
        </span>
        {ALL_FIELDS.filter((k) => counts[k] > 0).map((k) => {
          const active = activeField === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPickField(active ? null : k)}
              className={
                "rounded-full border px-2 py-0.5 transition " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100")
              }
            >
              {FIELD_LABELS[k]}: {counts[k]}
            </button>
          );
        })}
        {activeField && (
          <button
            type="button"
            onClick={() => onPickField(null)}
            className="ml-auto text-xs underline text-muted-foreground"
          >
            Clear filter
          </button>
        )}
      </CardContent>
    </Card>
  );
}