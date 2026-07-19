import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getPacketBuilderData,
  generateTransferPacket,
  savePacketSettings,
  getPacketSettings,
  type AvailableDoc,
  type PacketBuilderData,
} from "@/lib/transfer-packet.functions";

export interface PacketBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  violationId: string | null;
  onGenerated?: () => void;
}

export function PacketBuilderDialog({
  open,
  onOpenChange,
  violationId,
  onGenerated,
}: PacketBuilderDialogProps) {
  const loadFn = useServerFn(getPacketBuilderData);
  const genFn = useServerFn(generateTransferPacket);
  const getSettings = useServerFn(getPacketSettings);
  const saveSettings = useServerFn(savePacketSettings);

  const [data, setData] = useState<PacketBuilderData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragKind, setDragKind] = useState<string | null>(null);
  const [addressOverride, setAddressOverride] = useState("");
  const [allowUnsigned, setAllowUnsigned] = useState(false);

  useEffect(() => {
    if (!open || !violationId) return;
    setData(null);
    setSelected([]);
    setAddressOverride("");
    setAllowUnsigned(false);
    loadFn({ data: { violationId } })
      .then((res) => {
        setData(res);
        // Seed with default layout, filtered to only truly available docs.
        const avail = new Map(res.available.map((d) => [d.kind as string, d]));
        const seed = res.defaultLayout.filter((k) => avail.get(k)?.available);
        setSelected(seed.length > 0 ? seed : ["cover"]);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load documents"));
  }, [open, violationId, loadFn]);

  const available: AvailableDoc[] = data?.available ?? [];
  const availableByKind = useMemo(
    () => new Map(available.map((d) => [d.kind as string, d])),
    [available],
  );

  const unselected = available.filter((d) => !selected.includes(d.kind));

  const addToPacket = (kind: string) => {
    const doc = availableByKind.get(kind);
    if (!doc?.available) {
      toast.error(`${doc?.label ?? kind} is not available for this violation`);
      return;
    }
    if (selected.includes(kind)) return;
    setSelected((s) => [...s, kind]);
  };

  const removeFromPacket = (kind: string) => {
    setSelected((s) => s.filter((k) => k !== kind));
  };

  const move = (kind: string, dir: -1 | 1) => {
    setSelected((s) => {
      const i = s.indexOf(kind);
      if (i < 0) return s;
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const onDropSelected = (targetKind: string | null) => {
    if (!dragKind) return;
    setSelected((s) => {
      const without = s.filter((k) => k !== dragKind);
      if (targetKind === null) return [...without, dragKind];
      const idx = without.indexOf(targetKind);
      if (idx < 0) return [...without, dragKind];
      return [...without.slice(0, idx), dragKind, ...without.slice(idx)];
    });
    // If dropped from available column, ensure availability
    const doc = availableByKind.get(dragKind);
    if (doc && !doc.available) {
      // roll back
      setSelected((s) => s.filter((k) => k !== dragKind));
      toast.error(`${doc.label} is not available for this violation`);
    }
    setDragKind(null);
  };

  const generate = async () => {
    if (!violationId) return;
    if (selected.length === 0) {
      toast.error("Add at least one document to the packet");
      return;
    }
    const errorCode =
      data?.validation.ok === false ? data.validation.errorCode : null;
    if (errorCode === "missing_address" && addressOverride.trim().length < 5) {
      toast.error("Enter the renter's full address before generating");
      return;
    }
    if (errorCode === "missing_signature" && !allowUnsigned) {
      toast.error(
        "The agreement has no signature. Tick 'Proceed without signature' to override, or send a retroactive signing link first.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await genFn({
        data: {
          violationId,
          documents: selected,
          renterAddressOverride:
            addressOverride.trim().length > 0 ? addressOverride.trim() : undefined,
          allowUnsigned,
        },
      });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to generate packet");
        return;
      }
      if (res.base64 && res.filename) {
        const bin = atob(res.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      toast.success("Transfer packet generated");
      onGenerated?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAsDefault = async () => {
    setBusy(true);
    try {
      const cur = await getSettings();
      await saveSettings({
        data: {
          signerName: cur.signerName,
          signerTitle: cur.signerTitle,
          signerCompany: cur.signerCompany,
          defaultAuthority: cur.defaultAuthority,
          defaultPacketLayout: selected,
        },
      });
      toast.success("Saved as Default Packet Layout");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save default");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Packet Builder</DialogTitle>
          <DialogDescription>
            Drag documents to the right column in the order you want them in the packet, or use the
            buttons. Grayed-out items aren't on file for this violation.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {data.validation.ok === false && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive space-y-2">
                <p className="font-medium">
                  ⚠ {data.validation.error}
                </p>
                {data.validation.errorCode === "missing_address" && (
                  <div className="space-y-1 pt-1">
                    <Label className="text-xs text-destructive">
                      Enter renter's mailing address (required)
                    </Label>
                    <Input
                      value={addressOverride}
                      onChange={(e) => setAddressOverride(e.target.value)}
                      placeholder="123 Main St, Newark, NJ 07102"
                      className="bg-background text-foreground"
                    />
                    <p className="text-[11px] text-destructive/80">
                      This will be saved to the renter's record for future packets.
                    </p>
                  </div>
                )}
                {data.validation.errorCode === "missing_signature" && (
                  <label className="flex items-start gap-2 pt-1">
                    <Checkbox
                      checked={allowUnsigned}
                      onCheckedChange={(v) => setAllowUnsigned(Boolean(v))}
                      className="mt-0.5"
                    />
                    <span className="text-[12px]">
                      Proceed without renter signature (admin override). Prefer sending a retroactive signing link from the row first.
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {/* Available */}
              <div className="rounded-md border">
                <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  Available Documents
                </div>
                <ul className="max-h-80 space-y-1 overflow-auto p-2">
                  {unselected.length === 0 && (
                    <li className="p-2 text-xs text-muted-foreground">All items in packet.</li>
                  )}
                  {unselected.map((d) => (
                    <li
                      key={d.kind}
                      draggable={d.available}
                      onDragStart={() => d.available && setDragKind(d.kind)}
                      onDragEnd={() => setDragKind(null)}
                      className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-sm ${
                        d.available
                          ? "cursor-grab bg-background hover:bg-muted/40"
                          : "opacity-50"
                      }`}
                      title={d.available ? "" : "Not on file for this violation"}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            d.available ? "bg-emerald-500" : "bg-muted-foreground/40"
                          }`}
                        />
                        {d.label}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => addToPacket(d.kind)}
                        disabled={!d.available}
                      >
                        Add →
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Packet Contents */}
              <div
                className="rounded-md border"
                onDragOver={(e) => {
                  if (dragKind) e.preventDefault();
                }}
                onDrop={() => onDropSelected(null)}
              >
                <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  Packet Contents ({selected.length})
                </div>
                <ol className="max-h-80 space-y-1 overflow-auto p-2">
                  {selected.length === 0 && (
                    <li className="p-2 text-xs text-muted-foreground">
                      Drop documents here.
                    </li>
                  )}
                  {selected.map((k, i) => {
                    const d = availableByKind.get(k);
                    return (
                      <li
                        key={k}
                        draggable
                        onDragStart={() => setDragKind(k)}
                        onDragOver={(e) => {
                          if (dragKind) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          onDropSelected(k);
                        }}
                        onDragEnd={() => setDragKind(null)}
                        className="flex items-center justify-between rounded-md border bg-background px-2 py-1.5 text-sm hover:bg-muted/40"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                          {d?.label ?? k}
                        </span>
                        <span className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => move(k, -1)}
                            disabled={i === 0}
                            title="Move up"
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => move(k, 1)}
                            disabled={i === selected.length - 1}
                            title="Move down"
                          >
                            ↓
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFromPacket(k)}
                            title="Remove"
                          >
                            ✕
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={saveAsDefault} disabled={busy || !data}>
            Save as Default Layout
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy || !data || selected.length === 0}>
              {busy ? "Building…" : "Generate Packet"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}