import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Prefs = {
  smsOnOverdue: boolean;
  appAlertOnOverdue: boolean;
  appAlertOnDueSoon: boolean;
  weeklyDigest: boolean;
  adminPhone: string;
};

const KEY = "camauto.maintNotifPrefs.v1";
const DEFAULT: Prefs = {
  smsOnOverdue: true,
  appAlertOnOverdue: true,
  appAlertOnDueSoon: true,
  weeklyDigest: true,
  adminPhone: "267-221-3977",
};

export const Route = createFileRoute("/admin/maintenance-notifications")({
  head: () => ({ meta: [{ title: "Maintenance Notifications — Camauto Rentals" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const [p, setP] = useState<Prefs>(DEFAULT);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setP({ ...DEFAULT, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);

  function save(next: Prefs) {
    setP(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  }

  return (
    <div>
      <PageHeader title="Maintenance notifications" subtitle="Controls SMS + in-app alerts for scheduled maintenance." />
      <div className="max-w-lg space-y-3 px-2 pb-6 md:px-4">
        <Card>
          <CardHeader className="py-2">
            <CardTitle className="text-sm">Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="SMS admin on overdue"
              hint="Sends a text via GHL when an item becomes overdue."
              checked={p.smsOnOverdue}
              onChange={(v) => save({ ...p, smsOnOverdue: v })}
            />
            <Row
              label="App alert on overdue"
              checked={p.appAlertOnOverdue}
              onChange={(v) => save({ ...p, appAlertOnOverdue: v })}
            />
            <Row
              label="App alert when due within 7 days / 500 mi"
              checked={p.appAlertOnDueSoon}
              onChange={(v) => save({ ...p, appAlertOnDueSoon: v })}
            />
            <Row
              label="Weekly digest (Mon 8am)"
              hint="SMS summary of overdue + due-this-week items."
              checked={p.weeklyDigest}
              onChange={(v) => save({ ...p, weeklyDigest: v })}
            />
            <div>
              <Label className="text-xs">Admin phone</Label>
              <Input value={p.adminPhone} onChange={(e) => save({ ...p, adminPhone: e.target.value })} />
            </div>
            <Button variant="outline" onClick={() => { save(DEFAULT); toast.success("Reset to defaults"); }}>
              Reset to defaults
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label, hint, checked, onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div>{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}