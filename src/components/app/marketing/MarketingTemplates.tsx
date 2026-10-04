import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteTemplate, listTemplates, saveTemplate } from "@/lib/marketing.functions";
import { TEMPLATE_CATEGORIES } from "@/lib/marketing-shared";

type Draft = { id?: string; name: string; category: string; channel: "sms" | "email"; subject: string; body: string };

export function MarketingTemplates() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTemplates);
  const saveFn = useServerFn(saveTemplate);
  const delFn = useServerFn(deleteTemplate);
  const q = useQuery({ queryKey: ["marketing-templates"], queryFn: () => listFn() });
  const [draft, setDraft] = useState<Draft | null>(null);

  async function onSave() {
    if (!draft) return;
    try {
      await saveFn({ data: { ...draft, subject: draft.channel === "email" ? draft.subject : null } });
      toast.success("Template saved");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["marketing-templates"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setDraft({ name: "", category: "Promo", channel: "sms", subject: "", body: "" })}><Plus className="mr-2 h-4 w-4" />New template</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(q.data ?? []).map((t) => (
          <Card key={t.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t.name}</span>
                <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                <Badge variant="outline" className="text-[10px]">{t.channel === "sms" ? "Text" : "Email"}</Badge>
                <div className="ml-auto flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Edit template" onClick={() => setDraft({ id: t.id, name: t.name, category: t.category, channel: t.channel as "sms" | "email", subject: t.subject ?? "", body: t.body })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Delete template" onClick={async () => { if (!window.confirm("Delete this template?")) return; await delFn({ data: { id: t.id } }); qc.invalidateQueries({ queryKey: ["marketing-templates"] }); }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit template" : "New template"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Channel</Label>
                  <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v as "sms" | "email" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="sms">Text</SelectItem><SelectItem value="email">Email</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              {draft.channel === "email" && <div className="space-y-1"><Label>Subject</Label><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></div>}
              <div className="space-y-1">
                <Label>Message</Label>
                <Textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                <p className="text-xs text-muted-foreground">Merge fields: {"{{first_name}} {{last_name}} {{vehicle}} {{plate}} {{balance_due}} {{company_name}} {{link}}"}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={onSave} disabled={!draft?.name.trim() || !draft?.body.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
