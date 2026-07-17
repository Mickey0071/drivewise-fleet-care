import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPacketSettings,
  savePacketSettings,
  type PacketSettings,
} from "@/lib/transfer-packet.functions";

export const Route = createFileRoute("/admin/packet-settings")({
  head: () => ({ meta: [{ title: "Transfer Packet Settings — Camauto" }] }),
  component: PacketSettingsPage,
});

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(file);
  });
}

function PacketSettingsPage() {
  const loadFn = useServerFn(getPacketSettings);
  const saveFn = useServerFn(savePacketSettings);
  const fileRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<PacketSettings | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingSig, setPendingSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadFn()
      .then((s) => {
        setSettings(s);
        setPreview(s.signatureUrl);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"));
  }, [loadFn]);

  const update = <K extends keyof PacketSettings>(k: K, v: PacketSettings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s));

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      toast.error("Signature must be a PNG or JPG image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Signature file must be under 2MB");
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    setPendingSig(dataUrl);
    setPreview(dataUrl);
  };

  const onSave = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const res = await saveFn({
        data: {
          signerName: settings.signerName,
          signerTitle: settings.signerTitle,
          signerCompany: settings.signerCompany,
          defaultAuthority: settings.defaultAuthority,
          signatureDataUrl: pendingSig ?? undefined,
        },
      });
      setSettings(res);
      setPreview(res.signatureUrl);
      setPendingSig(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onClearSignature = async () => {
    if (!settings) return;
    if (!confirm("Remove the stored signature image?")) return;
    setBusy(true);
    try {
      const res = await saveFn({
        data: {
          signerName: settings.signerName,
          signerTitle: settings.signerTitle,
          signerCompany: settings.signerCompany,
          defaultAuthority: settings.defaultAuthority,
          clearSignature: true,
        },
      });
      setSettings(res);
      setPreview(null);
      setPendingSig(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Signature removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div>
        <PageHeader title="Transfer Packet Settings" />
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Transfer Packet Settings"
        subtitle="Signer identity + reusable signature image used on every Transfer of Responsibility cover page."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Authorized Signer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input
                value={settings.signerName}
                onChange={(e) => update("signerName", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={settings.signerTitle}
                onChange={(e) => update("signerTitle", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Company</Label>
              <Input
                value={settings.signerCompany}
                onChange={(e) => update("signerCompany", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Default toll authority</Label>
              <Input
                value={settings.defaultAuthority}
                onChange={(e) => update("defaultAuthority", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Signature Image</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload a PNG or JPG of the signer's signature. It renders once here and is reused on every generated packet.
            </p>
            <div className="flex h-32 items-center justify-center rounded-md border border-dashed bg-muted/30">
              {preview ? (
                <img
                  src={preview}
                  alt="Stored signature"
                  className="max-h-28 max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">No signature uploaded</span>
              )}
            </div>
            <div className="space-y-2">
              <Input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              {preview && (
                <Button type="button" size="sm" variant="ghost" onClick={onClearSignature}>
                  Remove signature
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}