import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { vehicles, fmtMoney } from "@/lib/mock/data";
import { maintenance as maintenanceList } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addVehicle, isVehicleBookable, awaitingPostReturnInspection, updateVehicleImage, uploadVehiclePhoto, useStoreVersion } from "@/lib/mock/store";
import { toast } from "sonner";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { ShareRentalDialog } from "@/components/app/ShareRentalDialog";
import { EditVehicleDialog } from "@/components/app/EditVehicleDialog";
import { VehiclePhotosDialog } from "@/components/app/VehiclePhotosDialog";
import { Share2, Camera, Pencil, Images } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/fleet")({
  head: () => ({ meta: [{ title: "Fleet — Camauto Rentals" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as "available" | "rented" | "inspection" | "maintenance" | "impound" | undefined) ?? undefined,
  }),
  component: FleetPage,
});

function FleetPage() {
  useStoreVersion();
  const [open, setOpen] = useState(false);
  const [reserveVehicleId, setReserveVehicleId] = useState<string | null>(null);
  const [shareVehicleId, setShareVehicleId] = useState<string | null>(null);
  const [editVehicleId, setEditVehicleId] = useState<string | null>(null);
  const [photosVehicleId, setPhotosVehicleId] = useState<string | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { status } = Route.useSearch();
  const navigate = Route.useNavigate();
  const goto = useNavigate();

  if (pathname !== "/fleet") return <Outlet />;

  const filtered = status === "available" ? vehicles.filter(v => isVehicleBookable(v.id)) : status ? vehicles.filter(v => v.status === status) : vehicles;
  return (
    <div>
      <PageHeader
        title="Fleet Manager"
        subtitle={status ? `${filtered.length} ${status} vehicle${filtered.length === 1 ? "" : "s"}` : `${vehicles.length} vehicles in service`}
        action={<Button onClick={() => setOpen(true)}>+ Add Vehicle</Button>}
      />
      {status && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>Filtered by status: <span className="font-medium capitalize">{status}</span></span>
          <Button size="sm" variant="ghost" onClick={() => navigate({ search: { status: undefined } })}>Clear</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(v => {
          const openIssueCount = maintenanceList.filter(m => m.vehicleId === v.id && !m.dateCompleted).length;
          return (
          <Card
            key={v.id}
            role="button"
            tabIndex={0}
            onClick={() => goto({ to: "/fleet/$vehicleId", params: { vehicleId: v.id } })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                goto({ to: "/fleet/$vehicleId", params: { vehicleId: v.id } });
              }
            }}
            className="cursor-pointer overflow-hidden transition-all hover:border-primary hover:shadow-md"
          >
            <div className="block">
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-xl bg-muted">
                <img
                  key={v.imageUrl ?? `default-${v.id}`}
                  src={v.imageUrl ?? carImage(v.model)}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  loading="lazy"
                  width={800}
                  height={512}
                  className="h-full w-full object-cover"
                />
                <div className="absolute right-2 top-2">
                  <StatusBadge status={v.status} />
                </div>
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{v.id} · Tag #{v.plate}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 font-semibold">
                      <span>{v.year} {v.make} {v.model}</span>
                      {awaitingPostReturnInspection(v.id) && (
                        <Badge variant="outline" className="border-destructive/60 bg-destructive/10 text-destructive">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Needs inspection
                        </Badge>
                      )}
                      {(openIssueCount > 0 || v.hasOpenIssues) && (
                        <Badge variant="destructive">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {openIssueCount > 0
                            ? `${openIssueCount} issue${openIssueCount === 1 ? "" : "s"}`
                            : "Open issue"}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{v.mileage.toLocaleString()} mi</span>
                  <span className="font-medium">{fmtMoney(v.weeklyRate)}/wk</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Risk tier {v.riskTier}</div>
              </CardContent>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border bg-muted/30 p-2" onClick={(e) => e.stopPropagation()}>
              <VehiclePhotoButton vehicleId={v.id} hasPhoto={!!v.imageUrl} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhotosVehicleId(v.id)}
                title="Manage & share photos"
              >
                <Images className="mr-1 h-4 w-4" /> Share photos
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => goto({ to: "/fleet/$vehicleId", params: { vehicleId: v.id }, search: { tab: "repairs" } })}
              >
                Profile
              </Button>
              {isVehicleBookable(v.id) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareVehicleId(v.id)}
                  title="Share rental link"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditVehicleId(v.id)}
                title="Edit vehicle"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={!isVehicleBookable(v.id)}
                onClick={() => setReserveVehicleId(v.id)}
              >
                Reserve
              </Button>
            </div>
          </Card>
          );
        })}
      </div>
      <AddVehicleDialog open={open} onClose={() => setOpen(false)} />
      <NewReservationDialog
        open={!!reserveVehicleId}
        onOpenChange={(o) => { if (!o) setReserveVehicleId(null); }}
        initialVehicleId={reserveVehicleId ?? undefined}
      />
      <ShareRentalDialog
        open={!!shareVehicleId}
        onOpenChange={(o) => { if (!o) setShareVehicleId(null); }}
        vehicle={shareVehicleId ? vehicles.find(v => v.id === shareVehicleId) ?? null : null}
      />
      <EditVehicleDialog
        open={!!editVehicleId}
        onOpenChange={(o) => { if (!o) setEditVehicleId(null); }}
        vehicle={editVehicleId ? vehicles.find(v => v.id === editVehicleId) ?? null : null}
        onDeleted={() => setEditVehicleId(null)}
      />
      <VehiclePhotosDialog
        open={!!photosVehicleId}
        onOpenChange={(o) => { if (!o) setPhotosVehicleId(null); }}
        vehicle={photosVehicleId ? vehicles.find(v => v.id === photosVehicleId) ?? null : null}
      />
    </div>
  );
}

function VehiclePhotoButton({ vehicleId, hasPhoto }: { vehicleId: string; hasPhoto: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setUploading(true);
          try {
            const url = await uploadVehiclePhoto(vehicleId, file);
            await updateVehicleImage(vehicleId, url);
            toast.success("Photo updated");
          } catch (err: any) {
            toast.error("Upload failed", { description: err?.message ?? "Try again" });
          } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
          }
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        title={hasPhoto ? "Change photo" : "Add photo"}
      >
        <Camera className="mr-1 h-4 w-4" />
        {uploading ? "Uploading…" : hasPhoto ? "Change photo" : "Add photo"}
      </Button>
    </>
  );
}

function AddVehicleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [mileage, setMileage] = useState<string>("");
  const [dailyRate, setDailyRate] = useState<string>("");
  const [weeklyRate, setWeeklyRate] = useState<string>("");
  const [riskTier, setRiskTier] = useState<"A" | "B" | "C">("A");
  const [color, setColor] = useState("");
  const [transmission, setTransmission] = useState<"Automatic" | "Manual" | "CVT" | "Other">("Automatic");
  const [fuelType, setFuelType] = useState<"Gas" | "Hybrid" | "Diesel" | "Electric">("Gas");
  const [seats, setSeats] = useState<string>("5");
  const [fuelLevelPickup, setFuelLevelPickup] = useState<"Full" | "3/4" | "1/2" | "1/4" | "Empty">("Full");
  const [ezPassTag, setEzPassTag] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setMake(""); setModel(""); setYear(new Date().getFullYear()); setVin(""); setPlate("");
    setMileage(""); setDailyRate(""); setWeeklyRate(""); setRiskTier("A");
    setColor(""); setTransmission("Automatic"); setFuelType("Gas"); setSeats("5");
    setFuelLevelPickup("Full"); setEzPassTag(""); setRegistrationExpiry(""); setInsuranceExpiry("");
    setNotes("");
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setSaving(false);
  }
  function pickPhoto(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    if (!file) { setPhotoFile(null); setPhotoPreview(null); return; }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }
  async function save() {
    if (!make || !model || !plate) { toast.error("Make, model, and plate are required"); return; }
    setSaving(true);
    const v = addVehicle({
      make, model, year, vin, plate,
      mileage: Number(mileage) || 0,
      dailyRate: Number(dailyRate) || 0,
      weeklyRate: Number(weeklyRate) || 0,
      riskTier,
      color: color || undefined,
      transmission,
      fuelType,
      seats: Number(seats) || undefined,
      fuelLevelPickup,
      ezPassTag: ezPassTag || undefined,
      registrationExpiry: registrationExpiry || undefined,
      insuranceExpiry: insuranceExpiry || undefined,
      notes: notes || undefined,
    });
    try {
      await (v as { cloudReady?: Promise<unknown> }).cloudReady;
      if (photoFile) {
        const url = await uploadVehiclePhoto(v.id, photoFile);
        await updateVehicleImage(v.id, url);
      }
      toast.success("Vehicle added", { description: `${v.year} ${v.make} ${v.model} (${v.id})` });
      reset(); onClose();
    } catch (e: any) {
      toast.error("Vehicle was not saved to cloud", { description: e?.message ?? "Try again" });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="!bottom-2 !top-2 flex h-auto max-h-none max-w-xl !translate-y-0 flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-3 py-1.5">
          <DialogTitle className="text-sm">Add vehicle</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-1.5 overflow-y-auto px-3 py-2 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Profile photo</Label>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                {photoPreview ? (
                  <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No photo</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
                {photoFile && (
                  <Button type="button" size="sm" variant="ghost" className="mt-1 h-7" onClick={() => pickPhoto(null)}>Remove</Button>
                )}
              </div>
            </div>
          </div>
          <div><Label>Make *</Label><Input value={make} onChange={e => setMake(e.target.value)} placeholder="Toyota" /></div>
          <div><Label>Model *</Label><Input value={model} onChange={e => setModel(e.target.value)} placeholder="Camry" /></div>
          <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></div>
          <div><Label>Color</Label><Input value={color} onChange={e => setColor(e.target.value)} placeholder="Silver" /></div>
          <div><Label>Plate *</Label><Input value={plate} onChange={e => setPlate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>VIN</Label><Input value={vin} onChange={e => setVin(e.target.value)} /></div>
          <div><Label>Mileage</Label><Input type="number" inputMode="numeric" value={mileage} onChange={e => setMileage(e.target.value)} /></div>
          <div><Label>Seats</Label><Input type="number" inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value)} /></div>
          <div>
            <Label>Transmission</Label>
            <Select value={transmission} onValueChange={(v) => setTransmission(v as typeof transmission)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Automatic">Automatic</SelectItem>
                <SelectItem value="Manual">Manual</SelectItem>
                <SelectItem value="CVT">CVT</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fuel type</Label>
            <Select value={fuelType} onValueChange={(v) => setFuelType(v as typeof fuelType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Gas">Gas</SelectItem>
                <SelectItem value="Hybrid">Hybrid</SelectItem>
                <SelectItem value="Diesel">Diesel</SelectItem>
                <SelectItem value="Electric">Electric</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fuel level at pickup</Label>
            <Select value={fuelLevelPickup} onValueChange={(v) => setFuelLevelPickup(v as typeof fuelLevelPickup)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Full">Full</SelectItem>
                <SelectItem value="3/4">3/4</SelectItem>
                <SelectItem value="1/2">1/2</SelectItem>
                <SelectItem value="1/4">1/4</SelectItem>
                <SelectItem value="Empty">Empty</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>EZ-Pass tag #</Label><Input value={ezPassTag} onChange={e => setEzPassTag(e.target.value)} /></div>
          <div><Label>Registration expiry</Label><Input type="date" value={registrationExpiry} onChange={e => setRegistrationExpiry(e.target.value)} /></div>
          <div><Label>Insurance expiry</Label><Input type="date" value={insuranceExpiry} onChange={e => setInsuranceExpiry(e.target.value)} /></div>
          <div>
            <Label>Risk tier</Label>
            <Select value={riskTier} onValueChange={(v) => setRiskTier(v as "A" | "B" | "C")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Daily rate ($)</Label><Input type="number" inputMode="decimal" value={dailyRate} onChange={e => setDailyRate(e.target.value)} /></div>
          <div><Label>Weekly rate ($)</Label><Input type="number" inputMode="decimal" value={weeklyRate} onChange={e => setWeeklyRate(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Label>Notes / known issues</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t bg-background px-3 py-2 sm:flex-row">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Add vehicle"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
