import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellOff, Send } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAlertSettings,
  updateAlertGlobal,
  updateAlertSection,
  sendTestAlert,
  type AlertSettingsRow,
} from "@/lib/alert-settings.functions";

export const Route = createFileRoute("/admin/alert-settings")({
  head: () => ({
    meta: [
      { title: "Alert Settings — Camauto Rentals" },
      {
        name: "description",
        content: "Control which text alerts Camauto Rentals sends, how often, and during what hours.",
      },
      { property: "og:title", content: "Alert Settings — Camauto Rentals" },
      {
        property: "og:description",
        content: "Master text switch, quiet hours and per-section alert frequency for the fleet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlertSettingsPage,
});

const SECTION_META: Record<
  string,
  { title: string; toggles: { key: string; label: string }[] }
> = {
  maintenance: {
    title: "Maintenance",
    toggles: [
      { key: "sms_on_overdue", label: "Text when an item goes overdue" },
      { key: "sms_on_due_soon", label: "Text when an item is due soon" },
      { key: "app_notification", label: "Show in-app warning" },
    ],
  },
  repairs: {
    title: "Repairs",
    toggles: [
      { key: "sms_on_opened", label: "Text when a repair is opened" },
      { key: "sms_on_mechanic_submit", label: "Text when a mechanic submits a diagnosis" },
      { key: "sms_on_completed", label: "Text when a repair is completed" },
      { key: "daily_open_summary", label: "Daily summary of open repairs" },
    ],
  },
  violations: {
    title: "Violations",
    toggles: [
      { key: "sms_on_new", label: "Text on new violation" },
      { key: "sms_on_unmatched_7d", label: "Text when unmatched 7+ days" },
    ],
  },
  payments: {
    title: "Payments",
    toggles: [
      { key: "sms_on_overdue", label: "Text on overdue payment" },
      { key: "sms_on_received", label: "Text on payment received" },
    ],
  },
  runner_tasks: {
    title: "Runner tasks",
    toggles: [
      { key: "sms_on_completed", label: "Text when a task is completed" },
      { key: "sms_on_declined", label: "Text when a task is declined or forced" },
    ],
  },
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function timeValue(v: string | null): string {
  return (v ?? "").slice(0, 5);
}

function AlertSettingsPage() {
  const load = useServerFn(getAlertSettings);
  const saveGlobal = useServerFn(updateAlertGlobal);
  const saveSection = useServerFn(updateAlertSection);
  const test = useServerFn(sendTestAlert);

  const [rows, setRows] = useState<AlertSettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load({})
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, [load]);

  const global = rows.find((r) => r.notification_type === "__global__");
  const sections = Object.keys(SECTION_META)
    .map((k) => rows.find((r) => r.notification_type === k))
    .filter(Boolean) as AlertSettingsRow[];

  function patch(type: string, patchObj: Partial<AlertSettingsRow>) {
    setRows((prev) =>
      prev.map((r) => (r.notification_type === type ? { ...r, ...patchObj } : r)),
    );
  }

  async function persistGlobal(next: AlertSettingsRow) {
    setSaving(true);
    try {
      await saveGlobal({
        data: {
          master_sms_enabled: next.master_sms_enabled,
          admin_phone: next.admin_phone,
          quiet_hours_start: next.quiet_hours_start,
          quiet_hours_end: next.quiet_hours_end,
          link_base_url: next.link_base_url,
        },
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function persistSection(next: AlertSettingsRow) {
    setSaving(true);
    try {
      await saveSection({
        data: {
          notification_type: next.notification_type as never,
          sms_enabled: next.sms_enabled,
          app_enabled: next.app_enabled,
          frequency: next.frequency as never,
          send_time: next.send_time,
          send_day: next.send_day,
          toggles: next.toggles ?? {},
        },
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Alert settings" subtitle="Loading…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Alert settings"
        subtitle="One switch controls every automatic text. Alerts are grouped by vehicle."
      />
      <div className="max-w-2xl space-y-3 px-2 pb-10 md:px-4">
        {global && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Master controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <div className="font-medium">All text alerts</div>
                  <div className="text-[11px] text-muted-foreground">
                    {global.master_sms_enabled
                      ? "Texts are sending per the settings below."
                      : "Off — nothing is texted, no matter the settings below."}
                  </div>
                </div>
                <Switch
                  checked={global.master_sms_enabled}
                  onCheckedChange={(v) => {
                    const next = { ...global, master_sms_enabled: v };
                    patch("__global__", next);
                    void persistGlobal(next);
                  }}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Admin phone</Label>
                  <Input
                    value={global.admin_phone ?? ""}
                    onChange={(e) => patch("__global__", { admin_phone: e.target.value })}
                    onBlur={() => void persistGlobal(global)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Link base URL</Label>
                  <Input
                    placeholder="https://camautorentals.com"
                    value={global.link_base_url ?? ""}
                    onChange={(e) => patch("__global__", { link_base_url: e.target.value })}
                    onBlur={() => void persistGlobal(global)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Quiet hours start</Label>
                  <Input
                    type="time"
                    value={timeValue(global.quiet_hours_start)}
                    onChange={(e) => patch("__global__", { quiet_hours_start: e.target.value })}
                    onBlur={() => void persistGlobal(global)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Quiet hours end</Label>
                  <Input
                    type="time"
                    value={timeValue(global.quiet_hours_end)}
                    onChange={(e) => patch("__global__", { quiet_hours_end: e.target.value })}
                    onBlur={() => void persistGlobal(global)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <BellOff className="mr-1 inline h-3 w-3" />
                Alerts raised during quiet hours are held and sent with the next digest.
              </p>
            </CardContent>
          </Card>
        )}

        {sections.map((s) => {
          const meta = SECTION_META[s.notification_type]!;
          return (
            <Card key={s.notification_type}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-sm">{meta.title}</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={async () => {
                    try {
                      await test({ data: { section: s.notification_type as never } });
                      toast.success("Test alert sent");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Test failed");
                    }
                  }}
                >
                  <Send className="mr-1 h-3 w-3" />
                  Test
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>Text alerts</div>
                  <Switch
                    checked={s.sms_enabled}
                    onCheckedChange={(v) => {
                      const next = { ...s, sms_enabled: v };
                      patch(s.notification_type, next);
                      void persistSection(next);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>In-app alerts</div>
                  <Switch
                    checked={s.app_enabled}
                    onCheckedChange={(v) => {
                      const next = { ...s, app_enabled: v };
                      patch(s.notification_type, next);
                      void persistSection(next);
                    }}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Frequency</Label>
                    <Select
                      value={s.frequency}
                      onValueChange={(v) => {
                        const next = { ...s, frequency: v };
                        patch(s.notification_type, next);
                        void persistSection(next);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">Immediate</SelectItem>
                        <SelectItem value="daily">Daily digest</SelectItem>
                        <SelectItem value="weekly">Weekly digest</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Send time</Label>
                    <Input
                      type="time"
                      value={timeValue(s.send_time)}
                      onChange={(e) => patch(s.notification_type, { send_time: e.target.value })}
                      onBlur={() => void persistSection(s)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Send day (weekly)</Label>
                    <Select
                      value={s.send_day ?? "monday"}
                      onValueChange={(v) => {
                        const next = { ...s, send_day: v };
                        patch(s.notification_type, next);
                        void persistSection(next);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAYS.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d[0]!.toUpperCase() + d.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  {meta.toggles.map((t) => (
                    <div key={t.key} className="flex items-center justify-between gap-3">
                      <div className="text-[13px]">{t.label}</div>
                      <Switch
                        checked={s.toggles?.[t.key] !== false}
                        onCheckedChange={(v) => {
                          const next = { ...s, toggles: { ...(s.toggles ?? {}), [t.key]: v } };
                          patch(s.notification_type, next);
                          void persistSection(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
