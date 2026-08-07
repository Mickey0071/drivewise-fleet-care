import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  parseViolationUpload,
  listPacketRenters,
  saveDisputePacket,
  lookupPlateMatches,
  type PacketDisputeType,
  type PacketViolationItem,
} from "@/lib/dispute-packets.functions";
import { renderMultiViolationDisputePdf } from "@/components/pdf/MultiViolationDisputePDF";
import { ManualRenterDialog } from "@/components/app/ManualRenterDialog";
import { SavedPacketDraftsDialog } from "@/components/app/SavedPacketDraftsDialog";
import { listPacketDrafts } from "@/lib/dispute-packets.functions";
import { saveLocalDraft, removeLocalDraft } from "@/lib/packet-drafts";
import { Textarea } from "@/components/ui/textarea";

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
  const draftsList = useServerFn(listPacketDrafts);
  const qc = useQueryClient();

  const { data: renterOptions = [] } = useQuery({
    queryKey: ["packet-renters"],
    queryFn: () => renters(),
  });

  const { data: drafts = [] } = useQuery({
    queryKey: ["packet-drafts"],
    queryFn: () => draftsList(),
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
  const [notes, setNotes] = useState("");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [autoSaveAt, setAutoSaveAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lookupMatches = useServerFn(lookupPlateMatches);
  /** normalized plate → renter permanently matched to it */
  const [plateMatches, setPlateMatches] = useState<
    Record<string, { id: string; name: string }>
  >({});
  const [matchPlate, setMatchPlate] = useState<string | null>(null);

  const norm = (p: string | null) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const matchedRows = useMemo(
    () => rows.filter((r) => Boolean(plateMatches[norm(r.plate)])),
    [rows, plateMatches],
  );
  const unmatchedRows = useMemo(
    () => rows.filter((r) => !plateMatches[norm(r.plate)]),
    [rows, plateMatches],
  );
  const unmatchedPlates = useMemo(
    () => Array.from(new Set(unmatchedRows.map((r) => r.plate).filter(Boolean) as string[])),
    [unmatchedRows],
  );

  // Resolve permanent plate → renter links whenever the plate set changes.
  const plateKey = useMemo(
    () => Array.from(new Set(rows.map((r) => norm(r.plate)).filter(Boolean))).sort().join(","),
    [rows],
  );
  useEffect(() => {
    if (!plateKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await lookupMatches({ data: { plates: plateKey.split(",") } });
        if (cancelled) return;
        setPlateMatches((prev) => {
          const next = { ...prev };
          for (const m of res) next[m.plate] = { id: m.driverId, name: m.renterName };
          return next;
        });
      } catch {
        /* matching is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateKey]);

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
      setAutoSaveAt(Date.now());
    }
  };

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const defaultName = () => {
    const plate = rows.find((r) => r.plate)?.plate;
    return name.trim() || `${plate ? `${plate} ` : ""}Dispute packet`;
  };

  const persistLocal = (id: string | null) => {
    const key = saveLocalDraft({
      ...(localKey ? { key: localKey } : {}),
      packetId: id,
      name: defaultName(),
      renterId: renterId || null,
      renterName: allRenters.find((r) => r.id === renterId)?.name ?? null,
      disputeType,
      notes: notes.trim() || null,
      items: rows.map(({ key: _k, confirmed: _c, ...it }) => it),
    });
    if (key) setLocalKey(key);
  };

  // Auto-save: browser immediately after parsing, server a few seconds later.
  useEffect(() => {
    if (autoSaveAt === null || rows.length === 0) return;
    persistLocal(packetId);
    const t = window.setTimeout(async () => {
      try {
        const res = await save({ data: { ...buildPayload("DRAFT"), name: defaultName() } });
        setPacketId(res.id);
        persistLocal(res.id);
        void qc.invalidateQueries({ queryKey: ["packet-drafts"] });
        toast.success("Saved to browser and server");
      } catch {
        /* keep the browser copy; user can Save Draft manually */
      }
    }, 7000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveAt]);

  const buildPayload = (status: "DRAFT" | "DISPUTED") => ({
    ...(packetId ? { id: packetId } : {}),
    name: name.trim(),
    renterId: renterId || null,
    renterName: allRenters.find((r) => r.id === renterId)?.name ?? null,
    disputeType,
    status,
    notes: notes.trim() || null,
    createdVia: "upload" as const,
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
      persistLocal(res.id);
      void qc.invalidateQueries({ queryKey: ["packet-drafts"] });
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
      const source = matchedRows.length > 0 ? matchedRows : rows;
      const items = source.map(({ key: _k, confirmed: _c, ...it }) => it);
      const bytes = await renderMultiViolationDisputePdf({
        packetName: name.trim(),
        renterName: allRenters.find((r) => r.id === renterId)?.name ?? null,
        disputeType,
        items,
      });
      let bin = "";
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      const res = await save({
        data: { ...buildPayload("DISPUTED"), items, pdfBase64: btoa(bin) },
      });
      setPacketId(res.id);
      removeLocalDraft({ ...(localKey ? { key: localKey } : {}), packetId: res.id });
      setLocalKey(null);
      void qc.invalidateQueries({ queryKey: ["packet-drafts"] });
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDraftsOpen(true)}>
              Saved drafts{drafts.length > 0 ? ` (${drafts.length})` : ""}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/violations">
                <ArrowLeft className="mr-1 h-4 w-4" /> Violations
              </Link>
            </Button>
          </div>
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
            <>
            <div className="flex flex-wrap items-center gap-4 border-b p-3 text-sm">
              <span>
                Matched violations: <strong>{matchedRows.length}</strong> ✅
              </span>
              <span>
                Unmatched violations: <strong>{unmatchedRows.length}</strong>{" "}
                {unmatchedRows.length > 0 ? "❌" : "✅"}
              </span>
            </div>
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
                    const match = plateMatches[norm(r.plate)];
                    return (
                      <tr key={r.key} className="border-b last:border-0 align-top">
                        <td className="p-3">
                          <div>{r.plate || "—"}</div>
                          {match ? (
                            <div className="text-xs text-muted-foreground">{match.name}</div>
                          ) : null}
                        </td>
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
                          {!match ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-destructive">Unmatched</span>
                              {r.plate ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => {
                                    setMatchPlate(r.plate);
                                    setManualOpen(true);
                                  }}
                                >
                                  Create agreement
                                </Button>
                              ) : null}
                            </div>
                          ) : flagged ? (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3.5 w-3.5" /> Confirm date
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Matched — ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {unmatchedPlates.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t p-3">
                <span className="text-sm text-muted-foreground">
                  Create agreements for unmatched violations:
                </span>
                {unmatchedPlates.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setMatchPlate(p);
                      setManualOpen(true);
                    }}
                  >
                    Create agreement — {p}
                  </Button>
                ))}
              </div>
            ) : null}
            </>
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
                  <SelectValue placeholder="Select renter from database" />
                </SelectTrigger>
                <SelectContent>
                  {allRenters.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="text-xs text-primary underline underline-offset-2"
              >
                Renter not found? Create one
              </button>
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

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes for this packet"
              rows={2}
            />
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
            <Button
              onClick={generate}
              disabled={busy !== null || (rows.length > 0 && matchedRows.length === 0)}
            >
              {busy === "generate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {matchedRows.length > 0 && unmatchedRows.length > 0
                ? `Generate for matched (${matchedRows.length})`
                : "Generate Packet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ManualRenterDialog
        open={manualOpen}
        onOpenChange={(o) => {
          setManualOpen(o);
          if (!o) setMatchPlate(null);
        }}
        plate={matchPlate ?? rows.find((r) => r.plate)?.plate ?? null}
        incidentDate={
          (matchPlate
            ? rows.find((r) => norm(r.plate) === norm(matchPlate) && r.incident_date)?.incident_date
            : rows.find((r) => r.incident_date)?.incident_date) ?? null
        }
        onCreated={(r) => {
          setManualRenters((prev) => [r, ...prev]);
          setRenterId(r.id);
        }}
        onMatched={(plate, renter) =>
          setPlateMatches((prev) => ({ ...prev, [norm(plate)]: renter }))
        }
      />

      <SavedPacketDraftsDialog
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        onResume={(d) => {
          setPacketId(d.id);
          setName(d.name);
          setRenterId(d.renterId ?? "");
          if (d.renterId && d.renterName) {
            setManualRenters((prev) =>
              prev.some((m) => m.id === d.renterId)
                ? prev
                : [{ id: d.renterId as string, name: d.renterName as string }, ...prev],
            );
          }
          setDisputeType(d.disputeType);
          setNotes(d.notes ?? "");
          setRows(
            d.items.map((it, i) => ({ ...it, key: `resume-${d.id}-${i}`, confirmed: true })),
          );
        }}
      />
    </div>
  );
}
