import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, FileText, Loader2, Upload, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadPdf } from "@/lib/pdf-to-image";
import {
  parseViolationUpload,
  listPacketRenters,
  saveDisputePacket,
  type PacketDisputeType,
  type PacketViolationItem,
} from "@/lib/dispute-packets.functions";
import { renderMultiViolationDisputePdf } from "@/components/pdf/MultiViolationDisputePDF";
import { ManualRenterDialog } from "@/components/app/ManualRenterDialog";

export const Route = createFileRoute("/violations_/dispute-packets")({
  head: () => ({
    meta: [
      { title: "Dispute Packet Builder — Camauto Rentals" },
      {
        name: "description",
        content:
          "Upload multiple violation PDFs, review the parsed rows, and generate a single signed dispute packet.",
      },
      { property: "og:title", content: "Dispute Packet Builder — Camauto Rentals" },
      {
        property: "og:description",
        content: "Build a multi-violation dispute packet from uploaded violation notices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DisputePacketBuilder,
});

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) =>
  s ? new Date(`${s.length === 10 ? s : s.slice(0, 10)}T00:00:00`).toLocaleDateString() : "—";

type Row = PacketViolationItem & { key: string; confirmed: boolean };

function DisputePacketBuilder() {
  const parse = useServerFn(parseViolationUpload);
  const save = useServerFn(saveDisputePacket);
  const renters = useServerFn(listPacketRenters);

  const { data: renterOptions = [] } = useQuery({
    queryKey: ["packet-renters"],
    queryFn: () => renters(),
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"draft" | "generate" | null>(null);
  const [packetId, setPacketId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [renterId, setRenterId] = useState<string>("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRenters, setManualRenters] = useState<{ id: string; name: string }[]>([]);
  const [disputeType, setDisputeType] = useState<PacketDisputeType>("lessor_exemption_ezpass");
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    const dates = rows
      .map((r) => r.incident_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    return {
      count: rows.length,
      total: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
    };
  }, [rows]);

  const allRenters = useMemo(
    () => [...manualRenters, ...renterOptions.filter((r) => !manualRenters.some((m) => m.id === r.id))],
    [manualRenters, renterOptions],
  );

  const needsReview = rows.some((r) => r.requires_manual_review && !r.confirmed);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type === "application/pdf");
    if (list.length === 0) {
      toast.error("Drop PDF files only.");
      return;
    }
    setUploading(true);
    try {
      for (const file of list) {
        try {
          const pdf = await loadPdf(file);
          const images: string[] = [];
          for (let p = 1; p <= Math.min(pdf.pageCount, 10); p++) {
            images.push(await pdf.renderPage(p));
          }
          const res = await parse({ data: { images, filename: file.name } });
          setRows((prev) => [
            ...prev,
            ...res.items.map((it, i) => ({
              ...it,
              key: `${file.name}-${Date.now()}-${i}`,
              confirmed: false,
            })),
          ]);
        } catch (e) {
          toast.error(`${file.name}: ${e instanceof Error ? e.message : "could not read"}`);
        }
      }
      toast.success("Documents processed");
    } finally {
      setUploading(false);
    }
  };

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const buildPayload = (status: "DRAFT" | "DISPUTED") => ({
    ...(packetId ? { id: packetId } : {}),
    name: name.trim(),
    renterId: renterId || null,
    renterName: allRenters.find((r) => r.id === renterId)?.name ?? null,
    disputeType,
    status,
    items: rows.map(({ key: _k, confirmed: _c, ...it }) => it),
  });

  const validate = () => {
    if (!name.trim()) {
      toast.error("Give the packet a name.");
      return false;
    }
    if (rows.length === 0) {
      toast.error("Upload at least one violation PDF.");
      return false;
    }
    return true;
  };

  const saveDraft = async () => {
    if (!validate()) return;
    setBusy("draft");
    try {
      const res = await save({ data: buildPayload("DRAFT") });
      setPacketId(res.id);
      toast.success("Draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!validate()) return;
    if (needsReview) {
      toast.error("Confirm the flagged incident dates first.");
      return;
    }
    setBusy("generate");
    try {
      const items = rows.map(({ key: _k, confirmed: _c, ...it }) => it);
      const bytes = await renderMultiViolationDisputePdf({
        packetName: name.trim(),
        renterName: allRenters.find((r) => r.id === renterId)?.name ?? null,
        disputeType,
        items,
      });
      let bin = "";
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      const res = await save({
        data: { ...buildPayload("DISPUTED"), pdfBase64: btoa(bin) },
      });
      setPacketId(res.id);
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.trim().replace(/[^\w\-]+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Packet generated and saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Dispute Packet Builder"
        subtitle="Drop violation PDFs, confirm dates, generate one packet"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Violations
            </Link>
          </Button>
        }
      />

      {/* Upload */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30"
            }`}
          >
            {uploading ? (
              <Loader2 className="mb-2 h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
            )}
            <p className="text-sm font-medium">Drop violation PDFs here</p>
            <p className="text-xs text-muted-foreground">or click to browse — all pages are read</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Violations list */}
      <Card className="mb-4">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No violations uploaded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Plate</th>
                    <th className="p-3">Incident date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const flagged = r.requires_manual_review && !r.confirmed;
                    return (
                      <tr key={r.key} className="border-b last:border-0 align-top">
                        <td className="p-3">{r.plate || "—"}</td>
                        <td className="p-3">
                          {flagged ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="date"
                                value={r.incident_date ?? ""}
                                onChange={(e) =>
                                  setRow(r.key, { incident_date: e.target.value || null })
                                }
                                className="h-8 w-[150px]"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => {
                                  if (!r.incident_date) {
                                    toast.error("Enter the incident date.");
                                    return;
                                  }
                                  setRow(r.key, { confirmed: true });
                                }}
                              >
                                Confirm
                              </Button>
                            </div>
                          ) : (
                            fmtDate(r.incident_date)
                          )}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary">{r.document_type}</Badge>
                        </td>
                        <td className="p-3 text-right font-semibold">{money(r.amount)}</td>
                        <td className="p-3">
                          {flagged ? (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3.5 w-3.5" /> Confirm date
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata + actions */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Packet name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="XYZ-1234 June EZ Pass"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Renter</Label>
              <Select value={renterId} onValueChange={setRenterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select renter" />
                </SelectTrigger>
                <SelectContent>
                  {allRenters.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Dispute type</Label>
              <Select
                value={disputeType}
                onValueChange={(v) => setDisputeType(v as PacketDisputeType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lessor_exemption_ezpass">
                    Lessor Exemption (EZ Pass)
                  </SelectItem>
                  <SelectItem value="improper_notice_ppa">Improper Notice (PPA)</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 rounded-md bg-muted/40 p-3 text-sm">
            <span>
              <span className="text-muted-foreground">Violations:</span>{" "}
              <strong>{summary.count}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">Total:</span>{" "}
              <strong>{money(summary.total)}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">Date range:</span>{" "}
              <strong>
                {summary.from ? `${fmtDate(summary.from)} – ${fmtDate(summary.to)}` : "—"}
              </strong>
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={saveDraft} disabled={busy !== null}>
              {busy === "draft" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Draft
            </Button>
            <Button onClick={generate} disabled={busy !== null}>
              {busy === "generate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Generate Packet
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
