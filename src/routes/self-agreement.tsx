import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Database } from "lucide-react";
import { RentalAgreement } from "@/components/app/RentalAgreement";
import { SignaturePad } from "@/components/app/SignaturePad";
import type { Driver, Rental, Vehicle } from "@/lib/mock/data";
import { toast } from "sonner";
import { generateSelfAgreementPdf } from "@/lib/self-agreement-pdf.functions";

export const Route = createFileRoute("/self-agreement")({
  head: () => ({ meta: [{ title: "Rental Agreement Violation — Camauto Rentals" }] }),
  component: SelfAgreementPage,
});

type FormState = {
  // Renter
  firstName: string; middleInitial: string; lastName: string;
  dateOfBirth: string; licenseNumber: string; dlState: string; licenseExpiry: string;
  phone: string; email: string;
  streetAddress: string; aptUnit: string; city: string; state: string; zipCode: string;
  altContactName: string; altContactPhone: string;
  // Vehicle
  year: string; make: string; model: string; color: string; plate: string; vin: string;
  fuelLevelPickup: string; ezPassTag: string;
  // Terms
  billingPeriod: "daily" | "weekly" | "monthly";
  rate: string; depositPaid: string; startDate: string; endDate: string;
};

const EMPTY: FormState = {
  firstName: "", middleInitial: "", lastName: "",
  dateOfBirth: "", licenseNumber: "", dlState: "", licenseExpiry: "",
  phone: "", email: "",
  streetAddress: "", aptUnit: "", city: "", state: "", zipCode: "",
  altContactName: "", altContactPhone: "",
  year: "", make: "", model: "", color: "", plate: "", vin: "",
  fuelLevelPickup: "", ezPassTag: "",
  billingPeriod: "weekly",
  rate: "", depositPaid: "", startDate: "", endDate: "",
};

function SelfAgreementPage() {
  const [f, setF] = useState<FormState>(EMPTY);
  const [signature, setSignature] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const set = (k: keyof FormState, v: string) => setF((prev) => ({ ...prev, [k]: v }) as FormState);

  const composedName = [f.firstName, f.middleInitial ? `${f.middleInitial}.` : "", f.lastName]
    .filter(Boolean).join(" ").trim();

  const driver = useMemo<Driver>(() => ({
    id: "self", fullName: composedName, phone: f.phone, email: f.email,
    licenseNumber: f.licenseNumber, licenseExpiry: f.licenseExpiry, insuranceOnFile: false,
    rideshare: "Uber", status: "active", dateAdded: new Date().toISOString().slice(0, 10),
    dateOfBirth: f.dateOfBirth || undefined,
    firstName: f.firstName || undefined, middleInitial: f.middleInitial || undefined,
    lastName: f.lastName || undefined, dlState: f.dlState || undefined,
    streetAddress: f.streetAddress || undefined, aptUnit: f.aptUnit || undefined,
    city: f.city || undefined, state: f.state || undefined, zipCode: f.zipCode || undefined,
    altContactName: f.altContactName || undefined, altContactPhone: f.altContactPhone || undefined,
  }), [f, composedName]);

  const vehicle = useMemo<Vehicle>(() => ({
    id: "self", make: f.make, model: f.model, year: Number(f.year) || 0,
    vin: f.vin, plate: f.plate, mileage: 0, status: "available",
    riskTier: "A", dailyRate: 0, weeklyRate: 0,
    color: f.color || undefined,
    fuelLevelPickup: (f.fuelLevelPickup as Vehicle["fuelLevelPickup"]) || undefined,
    ezPassTag: f.ezPassTag || undefined,
  }), [f]);

  const rental = useMemo<Rental>(() => ({
    id: "self", vehicleId: "self", driverId: "self",
    startDate: f.startDate, endDate: f.endDate || undefined,
    weeklyRate: Number(f.rate) || 0, rate: Number(f.rate) || 0,
    depositPaid: Number(f.depositPaid) || 0,
    paymentStatus: "current", billingPeriod: f.billingPeriod,
    signatureDataUrl: signature || undefined,
    signedBy: signature ? composedName : undefined,
    signedAt: signature ? new Date().toISOString() : undefined,
  }), [f, signature, composedName]);

  const download = async () => {
    if (!composedName) { toast.error("Enter the renter's name first"); return; }
    if (!signature) { toast.error("Please sign the agreement first"); return; }
    setDownloading(true);
    try {
      const { base64 } = await generateSelfAgreementPdf({
        data: {
          firstName: f.firstName, middleInitial: f.middleInitial, lastName: f.lastName,
          fullName: composedName,
          dateOfBirth: f.dateOfBirth, licenseNumber: f.licenseNumber, dlState: f.dlState, licenseExpiry: f.licenseExpiry,
          phone: f.phone, email: f.email,
          streetAddress: f.streetAddress, aptUnit: f.aptUnit, city: f.city, state: f.state, zipCode: f.zipCode,
          altContactName: f.altContactName, altContactPhone: f.altContactPhone,
          year: f.year, make: f.make, model: f.model, color: f.color, plate: f.plate, vin: f.vin,
          fuelLevelPickup: f.fuelLevelPickup, ezPassTag: f.ezPassTag,
          billingPeriod: f.billingPeriod,
          rate: f.rate, depositPaid: f.depositPaid, startDate: f.startDate, endDate: f.endDate,
          signedAt: new Date().toISOString(),
          signatureDataUrl: signature,
        },
      });
      const bin = atob(base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rental-agreement-${composedName.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[self-agreement] download failed", e);
      toast.error("Could not generate the agreement PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Rental Agreement Violation"
          subtitle="Fill in all details as the renter, sign, and download a signed agreement."
          action={
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/migrated-reservations">
                  <Database className="mr-1 h-4 w-4" /> Migrated Reservations
                </Link>
              </Button>
              <Button onClick={download} disabled={downloading}>
                <Download className="mr-1 h-4 w-4" /> {downloading ? "Generating…" : "Download signed PDF"}
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-6 print:hidden">
          <Card>
            <CardHeader><CardTitle>Renter information</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <F label="First name" v={f.firstName} on={(v) => set("firstName", v)} />
              <F label="Middle initial" v={f.middleInitial} on={(v) => set("middleInitial", v)} />
              <F label="Last name" v={f.lastName} on={(v) => set("lastName", v)} />
              <F label="Date of birth" type="date" v={f.dateOfBirth} on={(v) => set("dateOfBirth", v)} />
              <F label="Driver license #" v={f.licenseNumber} on={(v) => set("licenseNumber", v)} />
              <F label="DL state" v={f.dlState} on={(v) => set("dlState", v)} />
              <F label="License expiry" type="date" v={f.licenseExpiry} on={(v) => set("licenseExpiry", v)} />
              <F label="Phone" v={f.phone} on={(v) => set("phone", v)} />
              <F label="Email" v={f.email} on={(v) => set("email", v)} className="sm:col-span-2" />
              <F label="Street address" v={f.streetAddress} on={(v) => set("streetAddress", v)} className="sm:col-span-2" />
              <F label="Apt/Unit" v={f.aptUnit} on={(v) => set("aptUnit", v)} />
              <F label="City" v={f.city} on={(v) => set("city", v)} />
              <F label="State" v={f.state} on={(v) => set("state", v)} />
              <F label="ZIP" v={f.zipCode} on={(v) => set("zipCode", v)} />
              <F label="Alt contact name" v={f.altContactName} on={(v) => set("altContactName", v)} />
              <F label="Alt contact phone" v={f.altContactPhone} on={(v) => set("altContactPhone", v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vehicle</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <F label="Year" v={f.year} on={(v) => set("year", v)} />
              <F label="Make" v={f.make} on={(v) => set("make", v)} />
              <F label="Model" v={f.model} on={(v) => set("model", v)} />
              <F label="Color" v={f.color} on={(v) => set("color", v)} />
              <F label="License plate" v={f.plate} on={(v) => set("plate", v)} />
              <F label="VIN" v={f.vin} on={(v) => set("vin", v)} />
              <F label="Fuel level out" v={f.fuelLevelPickup} on={(v) => set("fuelLevelPickup", v)} />
              <F label="EZ-Pass tag #" v={f.ezPassTag} on={(v) => set("ezPassTag", v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Rental terms</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Billing period</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={f.billingPeriod}
                  onChange={(e) => set("billingPeriod", e.target.value)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <F label="Rate ($)" v={f.rate} on={(v) => set("rate", v)} />
              <F label="Security deposit ($)" v={f.depositPaid} on={(v) => set("depositPaid", v)} />
              <F label="Start date" type="date" v={f.startDate} on={(v) => set("startDate", v)} />
              <F label="End date" type="date" v={f.endDate} on={(v) => set("endDate", v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Signature</CardTitle></CardHeader>
            <CardContent>
              <SignaturePad value={signature ?? undefined} onChange={setSignature} />
            </CardContent>
          </Card>
        </div>

        <div className="rounded-md border bg-zinc-100 p-2 print:border-0 print:bg-white print:p-0">
          <div className="mb-2 px-1 text-xs font-medium text-muted-foreground print:hidden">Live preview</div>
          <div className="max-h-[85vh] overflow-auto rounded bg-white shadow-inner print:max-h-none print:overflow-visible print:shadow-none">
            <RentalAgreement rental={rental} driver={driver} vehicle={vehicle} />
          </div>
        </div>
      </div>
    </div>
  );
}

function F({
  label, v, on, type = "text", className,
}: { label: string; v: string; on: (v: string) => void; type?: string; className?: string }) {
  return (
    <div className={"space-y-1 " + (className ?? "")}>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}