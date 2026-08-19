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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  updateViolation,
} from "@/lib/violations.functions";
import { setViolationAuthority } from "@/lib/ezpass.functions";
import {
  updateRentalPeriodForViolation,
  uploadSignedAgreementForViolation,
  bulkUpdateRenterInfo,
} from "@/lib/violation-fields.functions";

/** Authority choices offered by the inline editor. */
export const INLINE_AUTHORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "nj_ezpass", label: "NJ EZ Pass" },
  { value: "ny_ezpass", label: "NY EZ Pass" },
  { value: "nj_turnpike", label: "NJ Turnpike" },
  { value: "pa_turnpike", label: "PA Turnpike" },
  { value: "ppa", label: "Philadelphia Parking (PPA)" },
  { value: "philadelphia_parking", label: "Philadelphia Parking" },
  { value: "nj_mvc", label: "NJ MVC" },
];

/** Fields the mail packet expects to have populated. */
export type FieldKey =
  | "ezpassRef"
  | "violationDate"
  | "amount"
  | "authority"
  | "renterName"
  | "renterAddress"
  | "renterPhone"
  | "licenseNumber"
  | "rentalStart"
  | "rentalEnd"
  | "signedAgreement";

export const FIELD_LABELS: Record<FieldKey, string> = {
  ezpassRef: "EZPass ref #",
  violationDate: "Violation date",
  amount: "Violation amount",
  authority: "Authority/agency",
  renterName: "Renter name",
  renterAddress: "Renter address",
  renterPhone: "Renter phone",
  licenseNumber: "Driver license #",
  rentalStart: "Rental start date",
  rentalEnd: "Rental end date",
  signedAgreement: "Signed agreement",
};

export const ALL_FIELDS: FieldKey[] = [
  "ezpassRef",
  "violationDate",
  "amount",
  "authority",
  "renterName",
  "renterAddress",
  "renterPhone",
  "licenseNumber",
  "rentalStart",
  "rentalEnd",
  "signedAgreement",
];

/** Fields that block "Ready to print". Everything else is nice-to-have. */
export const REQUIRED_FIELDS: FieldKey[] = [
  "ezpassRef",
  "renterName",
  "rentalStart",
  "rentalEnd",
  "signedAgreement",
];

/** Compute which packet fields are present on a violation row. */
export function fieldStatus(v: ViolationRow): Record<FieldKey, boolean> {
  const has = (s: string | null | undefined) => Boolean(s && String(s).trim());
  return {
    ezpassRef: has(v.reference_number),
    violationDate: has(v.date_issued),
    amount: Number(v.total_amount || v.amount) > 0,
    authority: has(v.authority_key),
    renterName: has(v.driver_name),
    renterAddress: has(v.driver_address),
    renterPhone: has(v.driver_phone),
    licenseNumber: has(v.driver_license_number),
    rentalStart: has(v.rental_start),
    rentalEnd: has(v.rental_end),
    signedAgreement: Boolean(v.agreement_on_file),
  };
}

export function missingFieldsFor(v: ViolationRow): FieldKey[] {
  const s = fieldStatus(v);
  return ALL_FIELDS.filter((k) => !s[k]);
}

export function missingRequiredFor(v: ViolationRow): FieldKey[] {
  const s = fieldStatus(v);
  return REQUIRED_FIELDS.filter((k) => !s[k]);
}

export function isPacketReady(v: ViolationRow): boolean {
  return missingRequiredFor(v).length === 0;
}

export function ReadinessBadge({ v }: { v: ViolationRow }) {
  const missingReq = missingRequiredFor(v);
  if (missingReq.length === 0) {
    return (
      <Badge className="border-emerald-300 bg-emerald-50 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
        🟢 Ready to print
      </Badge>
    );
  }
  return (
    <Badge className="border-red-300 bg-red-50 text-[11px] font-medium text-red-700 hover:bg-red-50">
      {missingReq.length} required missing
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Inline editing                                                      */
/* ------------------------------------------------------------------ */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(file);
  });
}

/**
 * Compact ✅/⚠️/❌ checklist on a violation row. Clicking any chip opens an
 * inline editor right on the card — no dialog, no navigation. Each field
 * writes to the table that owns it (violations / drivers / rentals).
 */
export function FieldChecklist({
  v,
  onDone,
  onAdminSign,
}: {
  v: ViolationRow;
  onDone?: () => void;
  onAdminSign?: (v: ViolationRow) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [start, setStart] = useState(v.rental_start ?? "");
  const [end, setEnd] = useState(v.rental_end ?? "");
  const [dateError, setDateError] = useState<string | null>(null);

  const refFn = useServerFn(setViolationReference);
  const renterFn = useServerFn(updateRenterInfoForViolation);
  const violationFn = useServerFn(updateViolation);
  const authorityFn = useServerFn(setViolationAuthority);
  const periodFn = useServerFn(updateRentalPeriodForViolation);
  const uploadFn = useServerFn(uploadSignedAgreementForViolation);

  const s = fieldStatus(v);

  const finish = (msg: string) => {
    toast.success(msg);
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["violations"] });
    onDone?.();
  };

  const openEditor = (k: FieldKey) => {
    if (editing === k) {
      setEditing(null);
      return;
    }
    setEditing(k);
    setStart(v.rental_start ?? "");
    setEnd(v.rental_end ?? "");
    setDateError(null);
    setText(
      k === "ezpassRef"
        ? v.reference_number ?? ""
        : k === "violationDate"
          ? (v.date_issued ?? "").slice(0, 10)
          : k === "amount"
            ? String(v.amount ?? "")
            : k === "renterName"
              ? v.driver_name ?? ""
              : k === "renterAddress"
                ? v.driver_address ?? ""
                : k === "renterPhone"
                  ? v.driver_phone ?? ""
                  : k === "licenseNumber"
                    ? v.driver_license_number ?? ""
                    : "",
    );
  };

  const saveText = async (k: FieldKey) => {
    const val = text.trim();
    if (!val) {
      toast.error(`Enter a value for ${FIELD_LABELS[k]}`);
      return;
    }
    setBusy(true);
    try {
      if (k === "ezpassRef") {
        await refFn({ data: { id: v.id, referenceNumber: val } });
      } else if (k === "violationDate") {
        await violationFn({ data: { id: v.id, date: val } });
      } else if (k === "amount") {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) throw new Error("Amount invalid");
        await violationFn({ data: { id: v.id, amount: n } });
      } else {
        await renterFn({
          data: {
            violationId: v.id,
            fullName: k === "renterName" ? val : undefined,
            address: k === "renterAddress" ? val : undefined,
            phone: k === "renterPhone" ? val : undefined,
            licenseNumber: k === "licenseNumber" ? val : undefined,
          },
        });
      }
      finish(`${FIELD_LABELS[k]} saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAuthority = async (value: string) => {
    setBusy(true);
    try {
      await authorityFn({ data: { id: v.id, authorityKey: value || null } });
      finish("Authority saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const saveDates = async () => {
    setDateError(null);
    if (!start || !end) {
      setDateError("Enter both a start and an end date.");
      return;
    }
    if (start > end) {
      setDateError("Start date must be on or before the end date.");
      return;
    }
    setBusy(true);
    try {
      await periodFn({ data: { violationId: v.id, startDate: start, endDate: end } });
      finish("Rental period saved — packet will use these dates");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setDateError(`❌ ${msg || "Could not save dates. Try again or contact support."}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadAgreement = async (file: File | null) => {
    if (!file) return;
    const ok = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!ok) {
      toast.error("Choose a PDF or image file");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await uploadFn({ data: { violationId: v.id, dataUrl } });
      finish("Signed agreement attached");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const chipClass = (k: FieldKey) => {
    if (s[k]) return "text-emerald-600";
    return REQUIRED_FIELDS.includes(k) ? "text-red-600" : "text-amber-600";
  };
  const icon = (k: FieldKey) => (s[k] ? "✅" : REQUIRED_FIELDS.includes(k) ? "❌" : "⚠️");

  const isDateField = editing === "rentalStart" || editing === "rentalEnd";
  const uploadId = `signed-agr-${v.id}`;

  return (
    <div className="mt-1 space-y-1">
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] leading-snug">
        {ALL_FIELDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => openEditor(k)}
            className={`text-left hover:underline ${chipClass(k)} ${editing === k ? "font-semibold" : ""}`}
            title={s[k] ? "On file — click to edit" : "Missing — click to fill"}
          >
            {icon(k)} {FIELD_LABELS[k]}
          </button>
        ))}
      </div>

      {editing && editing !== "signedAgreement" && editing !== "authority" && !isDateField && (
        <div className="flex items-center gap-1 pt-1">
          <Input
            autoFocus
            type={editing === "violationDate" ? "date" : editing === "amount" ? "number" : "text"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveText(editing);
              if (e.key === "Escape") setEditing(null);
            }}
            placeholder={FIELD_LABELS[editing]}
            className="h-7 w-52 text-xs"
          />
          <Button size="sm" className="h-7 px-2" disabled={busy} onClick={() => saveText(editing)}>
            {busy ? "…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(null)}>
            ✕
          </Button>
        </div>
      )}

      {editing === "authority" && (
        <div className="flex items-center gap-1 pt-1">
          <select
            className="h-7 rounded border bg-background px-1 text-xs"
            defaultValue={v.authority_key ?? ""}
            disabled={busy}
            onChange={(e) => saveAuthority(e.target.value)}
          >
            <option value="">— select —</option>
            {INLINE_AUTHORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(null)}>
            ✕
          </Button>
        </div>
      )}

      {isDateField && (
        <div className="space-y-1 pt-1">
        <div className="flex flex-wrap items-end gap-1">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Start</div>
            <Input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setDateError(null);
              }}
              className="h-7 w-36 text-xs"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">End</div>
            <Input
              type="date"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setDateError(null);
              }}
              className="h-7 w-36 text-xs"
            />
          </div>
          <Button size="sm" className="h-7 px-2" disabled={busy} onClick={saveDates}>
            {busy ? "…" : "Save dates"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(null)}>
            ✕
          </Button>
        </div>
        {dateError && (
          <div className="text-[11px] font-medium text-red-600">{dateError}</div>
        )}
        </div>
      )}

      {editing === "signedAgreement" && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
          {s.signedAgreement ? (
            <span className="text-emerald-600">✅ Agreement signed — replace below if needed</span>
          ) : (
            <span className="text-red-600">⚠️ Agreement not signed</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={busy}
            onClick={() => onAdminSign?.(v)}
          >
            ✍️ Admin Sign Now
          </Button>
          <input
            id={uploadId}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => uploadAgreement(e.target.files?.[0] ?? null)}
          />
          <label
            htmlFor={uploadId}
            className="cursor-pointer rounded border px-2 py-1 hover:bg-muted"
          >
            {busy ? "Uploading…" : "📎 Upload Signed Copy"}
          </label>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(null)}>
            ✕
          </Button>
        </div>
      )}
    </div>
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
  const promptable = missing.filter((k) =>
    ["ezpassRef", "renterName", "renterAddress", "renterPhone", "licenseNumber"].includes(k),
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
            {promptable.map((k) => (
              <div key={k} className="space-y-1">
                <Label className="text-xs">{FIELD_LABELS[k]}</Label>
                <Input
                  value={form[k] ?? ""}
                  onChange={(e) => setField(k, e.target.value)}
                  placeholder={
                    k === "renterAddress"
                      ? "123 Main St, Newark, NJ 07102"
                      : k === "ezpassRef"
                        ? "EZPass reference number"
                        : ""
                  }
                />
              </div>
            ))}

            {missing.includes("signedAgreement") && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                ⚠️ No signed agreement on file. Use the inline "Signed agreement"
                chip on the row to sign or upload one.
              </div>
            )}
            {(missing.includes("rentalStart") || missing.includes("rentalEnd")) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                ⚠️ Rental period dates missing. Edit them inline on the row.
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

/** Bulk edit panel — apply renter details to every selected violation. */
export function BulkRenterEditDialog({
  open,
  onOpenChange,
  rows,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: ViolationRow[];
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const bulkFn = useServerFn(bulkUpdateRenterInfo);
  const [address, setAddress] = useState("");
  const [license, setLicense] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const names = Array.from(new Set(rows.map((r) => r.driver_name).filter(Boolean)));

  const save = async () => {
    setBusy(true);
    try {
      await bulkFn({
        data: {
          violationIds: rows.map((r) => r.id),
          address: address || undefined,
          licenseNumber: license || undefined,
          phone: phone || undefined,
        },
      });
      toast.success(`Applied to ${rows.length} violation${rows.length === 1 ? "" : "s"}`);
      setAddress("");
      setLicense("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["violations"] });
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply to all {rows.length} selected violations</DialogTitle>
          <DialogDescription>
            {names.length === 1
              ? `All selected belong to ${names[0]}.`
              : names.length > 1
                ? `Selected renters: ${names.join(", ")}. Values are saved to each renter record.`
                : "Values are saved to each violation's renter record."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Renter address</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Newark, NJ 07102"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Driver license #</Label>
            <Input value={license} onChange={(e) => setLicense(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Renter phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || rows.length === 0 || (!address && !license && !phone)}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save to all selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    const c = Object.fromEntries(ALL_FIELDS.map((k) => [k, 0])) as Record<FieldKey, number>;
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
          const required = REQUIRED_FIELDS.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPickField(active ? null : k)}
              className={
                "rounded-full border px-2 py-0.5 transition " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : required
                    ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
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
