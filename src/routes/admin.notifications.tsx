import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Save, Bell } from "lucide-react";
import {
  listNotificationSettings,
  updateNotificationSetting,
  testSendNotification,
} from "@/lib/notifications.functions";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Camauto Rentals" }] }),
  component: NotificationsPage,
});

type Setting = {
  id: string;
  notification_type: string;
  enabled: boolean;
  send_time: string | null;
  recipient_type: string;
  recipient_number: string | null;
  message_template: string | null;
  link_template: string | null;
};

const META: Record<string, { name: string; icon: string; timing: string; scheduled: boolean }> = {
  pending_agreements: { name: "Pending Rental Agreements (Unsigned)", icon: "📝", timing: "Daily", scheduled: true },
  extension_pending: { name: "Extension Links Pending", icon: "🔗", timing: "Real-time", scheduled: false },
  admin_morning_text: { name: "Admin Morning Text (Active Repairs)", icon: "🔧", timing: "Daily", scheduled: true },
  new_issue_alerts: { name: "New Issue Alerts", icon: "⚠️", timing: "Real-time", scheduled: false },
  past_due_payments: { name: "Past Due Payments", icon: "💰", timing: "Daily", scheduled: true },
  auto_extension_links: { name: "Auto-Extension Links (Daily/Weekly)", icon: "📅", timing: "Daily", scheduled: true },
  autopay_reminders: { name: "Auto-Pay Reminders (24hr before charge)", icon: "⏰", timing: "24h before charge", scheduled: false },
};

const ORDER = [
  "pending_agreements",
  "extension_pending",
  "admin_morning_text",
  "new_issue_alerts",
  "past_due_payments",
  "auto_extension_links",
  "autopay_reminders",
];

function NotificationsPage() {
  const load = useServerFn(listNotificationSettings);
  const save = useServerFn(updateNotificationSetting);
  const test = useServerFn(testSendNotification);

  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    load()
      .then((r) => setRows((r.settings as Setting[]) ?? []))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [load]);

  const patch = (type: string, p: Partial<Setting>) =>
    setRows((prev) => prev.map((r) => (r.notification_type === type ? { ...r, ...p } : r)));

  const onSave = async (s: Setting) => {
    setBusy(s.notification_type + ":save");
    try {
      await save({
        data: {
          notification_type: s.notification_type,
          enabled: s.enabled,
          send_time: s.send_time,
          recipient_type: (s.recipient_type as "admin" | "customer" | "both") ?? "admin",
          recipient_number: s.recipient_number,
          message_template: s.message_template,
          link_template: s.link_template,
        },
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const onTest = async (s: Setting) => {
    setBusy(s.notification_type + ":test");
    try {
      await test({
        data: {
          notification_type: s.notification_type,
          message_template: s.message_template,
          link_template: s.link_template,
        },
      });
      toast.success("Test sent to 267-221-3977");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test send failed");
    } finally {
      setBusy(null);
    }
  };

  const sorted = [...rows].sort(
    (a, b) => ORDER.indexOf(a.notification_type) - ORDER.indexOf(b.notification_type),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications Control Center"
        description="Manage all SMS and email alerts. Turn each on or off, customize timing, message, and links."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4">
          {sorted.map((s) => {
            const meta = META[s.notification_type] ?? {
              name: s.notification_type,
              icon: "🔔",
              timing: "—",
              scheduled: false,
            };
            return (
              <Card key={s.notification_type} className={s.enabled ? "" : "opacity-70"}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span aria-hidden>{meta.icon}</span>
                      {meta.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.enabled ? "default" : "secondary"}>
                        {s.enabled ? "ON" : "OFF"}
                      </Badge>
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => patch(s.notification_type, { enabled: v })}
                        aria-label="Toggle notification"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Time of send</Label>
                      {meta.scheduled ? (
                        <Input
                          type="time"
                          value={s.send_time ?? ""}
                          onChange={(e) => patch(s.notification_type, { send_time: e.target.value })}
                        />
                      ) : (
                        <div className="flex h-9 items-center text-sm text-muted-foreground">
                          {meta.timing}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Recipient</Label>
                      <Select
                        value={s.recipient_type ?? "admin"}
                        onValueChange={(v) => patch(s.notification_type, { recipient_type: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                          <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Admin number</Label>
                      <Input
                        value={s.recipient_number ?? ""}
                        onChange={(e) => patch(s.notification_type, { recipient_number: e.target.value })}
                        placeholder="267-221-3977"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Message template</Label>
                    <Textarea
                      rows={2}
                      value={s.message_template ?? ""}
                      onChange={(e) => patch(s.notification_type, { message_template: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Link (use [link] placeholder)</Label>
                    <Input
                      value={s.link_template ?? ""}
                      onChange={(e) => patch(s.notification_type, { link_template: e.target.value })}
                      placeholder="[link]"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === s.notification_type + ":test"}
                      onClick={() => onTest(s)}
                    >
                      <Send className="mr-1 h-4 w-4" />
                      Test Send
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === s.notification_type + ":save"}
                      onClick={() => onSave(s)}
                    >
                      <Save className="mr-1 h-4 w-4" />
                      Save Changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}