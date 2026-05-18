import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Save, Eye } from "lucide-react";
import {
  useAgreementSettings,
  setAgreementSettings,
  resetAgreementSettings,
  type AgreementSettings,
} from "@/lib/agreementSettings";
import { RentalAgreement } from "@/components/app/RentalAgreement";
import type { Driver, Rental, Vehicle } from "@/lib/mock/data";
import { toast } from "sonner";

export const Route = createFileRoute("/rental-agreement")({
  head: () => ({ meta: [{ title: "Rental Agreement — Camauto Rentals" }] }),
  component: RentalAgreementSettingsPage,
});

const sampleVehicle: Vehicle = {
  id: "veh_sample", make: "Toyota", model: "Camry", year: 2023,
  vin: "4T1B11HK0KU000000", plate: "SAMPLE-1", mileage: 24500,
  status: "available", riskTier: "A", dailyRate: 85, weeklyRate: 450,
};
const sampleDriver: Driver = {
  id: "drv_sample", fullName: "Sample Renter", phone: "(555) 123-4567",
  email: "renter@example.com", licenseNumber: "D1234567",
  licenseExpiry: "2028-06-01", insuranceOnFile: true,
  rideshare: "Uber", status: "active", dateAdded: "2026-01-01",
};
const sampleRental: Rental = {
  id: "rnt_sample", vehicleId: "veh_sample", driverId: "drv_sample",
  startDate: "2026-05-15", weeklyRate: 450, depositPaid: 300,
  paymentStatus: "current", billingPeriod: "weekly", rate: 450,
};

function RentalAgreementSettingsPage() {
  const saved = useAgreementSettings();
  const [draft, setDraft] = useState<AgreementSettings>(saved);
  const [showPreview, setShowPreview] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = () => {
    setAgreementSettings(draft);
    toast.success("Agreement settings saved");
  };
  const reset = () => {
    resetAgreementSettings();
    setDraft({ ...saved });
    toast.success("Reset to defaults");
  };

  const updateCompany = (k: keyof AgreementSettings["company"], v: string) =>
    setDraft({ ...draft, company: { ...draft.company, [k]: v } });
  const updateFee = (k: keyof AgreementSettings["fees"], v: string) =>
    setDraft({ ...draft, fees: { ...draft.fees, [k]: v } });

  const moveClause = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.clauses.length) return;
    const next = [...draft.clauses];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft({ ...draft, clauses: next });
  };
  const addClause = () =>
    setDraft({ ...draft, clauses: [...draft.clauses, { title: "New clause", body: "Clause text…" }] });
  const removeClause = (i: number) =>
    setDraft({ ...draft, clauses: draft.clauses.filter((_, k) => k !== i) });
  const updateClause = (i: number, k: "title" | "body", v: string) => {
    const next = [...draft.clauses];
    next[i] = { ...next[i], [k]: v };
    setDraft({ ...draft, clauses: next });
  };

  const updateRow = (i: number, v: string) => {
    const next = [...draft.conditionRows];
    next[i] = v;
    setDraft({ ...draft, conditionRows: next });
  };
  const addRow = () => setDraft({ ...draft, conditionRows: [...draft.conditionRows, "New location"] });
  const removeRow = (i: number) => setDraft({ ...draft, conditionRows: draft.conditionRows.filter((_, k) => k !== i) });

  return (
    <div>
      <PageHeader
        title="Rental Agreement"
        subtitle="Edit the contract template that gets sent to renters."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
              <Eye className="mr-1 h-4 w-4" />
              {showPreview ? "Hide preview" : "Show preview"}
            </Button>
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="mr-1 h-4 w-4" /> Reset to defaults
            </Button>
            <Button onClick={save} disabled={!dirty}>
              <Save className="mr-1 h-4 w-4" /> Save changes
            </Button>
          </div>
        }
      />

      <div className={showPreview ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}>
        <Tabs defaultValue="company">
          <TabsList>
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="fees">Fees & Limits</TabsTrigger>
            <TabsTrigger value="condition">Condition Checklist</TabsTrigger>
            <TabsTrigger value="clauses">Clauses</TabsTrigger>
          </TabsList>

          <TabsContent value="company">
            <Card>
              <CardHeader><CardTitle>Company information</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal name" value={draft.company.legalName} onChange={(v) => updateCompany("legalName", v)} />
                <Field label="Doing business as (DBA)" value={draft.company.dba} onChange={(v) => updateCompany("dba", v)} />
                <Field label="Address" value={draft.company.address} onChange={(v) => updateCompany("address", v)} className="sm:col-span-2" />
                <Field label="Phone" value={draft.company.phone} onChange={(v) => updateCompany("phone", v)} />
                <Field label="Website" value={draft.company.website} onChange={(v) => updateCompany("website", v)} />
                <Field label="Damage alert SMS recipient (E.164 phone)" value={draft.company.damageAlertPhone} onChange={(v) => updateCompany("damageAlertPhone", v)} className="sm:col-span-2" />
                <Field label="Runner inspection SMS recipient (E.164 phone)" value={draft.company.runnerInspectionPhone} onChange={(v) => updateCompany("runnerInspectionPhone", v)} className="sm:col-span-2" />
                <Field label="Agreement version tag" value={draft.agreementVersion} onChange={(v) => setDraft({ ...draft, agreementVersion: v })} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fees">
            <Card>
              <CardHeader>
                <CardTitle>Fees, limits & rates</CardTitle>
                <p className="text-xs text-muted-foreground">These values fill in the Rental Terms section and the matching clauses automatically.</p>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Daily late fee" value={draft.fees.dailyLateFee} onChange={(v) => updateFee("dailyLateFee", v)} />
                <Field label="Repossession grace (days)" value={draft.fees.repossessionGraceDays} onChange={(v) => updateFee("repossessionGraceDays", v)} />
                <Field label="Mileage cap / week" value={draft.fees.mileageCapPerWeek} onChange={(v) => updateFee("mileageCapPerWeek", v)} />
                <Field label="Excess mileage rate (per mile)" value={draft.fees.excessMileageRate} onChange={(v) => updateFee("excessMileageRate", v)} />
                <Field label="Fuel fee per gallon" value={draft.fees.fuelFeePerGallon} onChange={(v) => updateFee("fuelFeePerGallon", v)} />
                <Field label="Cleaning fee range" value={draft.fees.cleaningFeeRange} onChange={(v) => updateFee("cleaningFeeRange", v)} />
                <Field label="Toll/PPA admin fee per incident" value={draft.fees.tollAdminFee} onChange={(v) => updateFee("tollAdminFee", v)} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="condition">
            <Card>
              <CardHeader>
                <CardTitle>Condition-at-pickup checklist rows</CardTitle>
                <p className="text-xs text-muted-foreground">These rows appear in the inspection table on every printed agreement.</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {draft.conditionRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={row} onChange={(e) => updateRow(i, e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label="Remove row">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addRow}>
                  <Plus className="mr-1 h-4 w-4" /> Add row
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="clauses">
            <Card>
              <CardHeader>
                <CardTitle>Contract clauses</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Use these placeholders inside clause body text — they're replaced automatically:
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{COMPANY}}"}</code>
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{LEGAL_NAME}}"}</code>
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{GRACE_DAYS}}"}</code>
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{EXCESS_MILEAGE}}"}</code>
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{FUEL_FEE}}"}</code>
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{CLEANING_FEE}}"}</code>
                  <code className="ml-1 rounded bg-muted px-1 text-[11px]">{"{{TOLL_ADMIN}}"}</code>
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {draft.clauses.map((c, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">{i + 1}.</span>
                      <Input value={c.title} onChange={(e) => updateClause(i, "title", e.target.value)} className="flex-1" />
                      <Button variant="ghost" size="icon" onClick={() => moveClause(i, -1)} disabled={i === 0} aria-label="Move up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => moveClause(i, 1)} disabled={i === draft.clauses.length - 1} aria-label="Move down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeClause(i)} aria-label="Remove clause">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={c.body}
                      onChange={(e) => updateClause(i, "body", e.target.value)}
                      rows={4}
                      className="text-sm"
                    />
                  </div>
                ))}
                <Button variant="outline" onClick={addClause}>
                  <Plus className="mr-1 h-4 w-4" /> Add clause
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {showPreview && (
          <div className="rounded-md border bg-zinc-100 p-2">
            <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
              Live preview {dirty && <span className="text-amber-600">(unsaved — preview reflects saved settings)</span>}
            </div>
            <div className="max-h-[80vh] overflow-auto rounded bg-white shadow-inner">
              <RentalAgreement rental={sampleRental} driver={sampleDriver} vehicle={sampleVehicle} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, className,
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={"space-y-1 " + (className ?? "")}>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}