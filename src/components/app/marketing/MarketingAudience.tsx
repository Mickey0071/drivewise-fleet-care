import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConsentBadge, ConsentDialog, LeadSourceBadge, type ConsentTarget } from "@/components/app/ConsentDialog";
import { deleteSegment, listSegments, saveSegment } from "@/lib/marketing.functions";
import {
  applyFilters, CONSENT_LABEL, EMPTY_FILTERS, filtersActive, hasPhone, isExcluded, LEAD_SOURCE_LABEL,
  type AudienceCustomer, type AudienceFilters, type ConsentStatus, type LeadSource,
} from "@/lib/marketing-shared";

export interface AudienceSelection {
  label: string;
  customerIds: string[];
}

interface SavedState {
  filters: AudienceFilters;
  selectAll: boolean;
  added: string[];
  removed: string[];
}

export function MarketingAudience({
  customers, onRefresh, onUse,
}: {
  customers: AudienceCustomer[];
  onRefresh: () => void;
  onUse: (sel: AudienceSelection) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSegments);
  const saveFn = useServerFn(saveSegment);
  const delFn = useServerFn(deleteSegment);
  const segQ = useQuery({ queryKey: ["marketing-segments"], queryFn: () => listFn() });

  const [filters, setFilters] = useState<AudienceFilters>(EMPTY_FILTERS);
  const [selectAll, setSelectAll] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [segName, setSegName] = useState("");
  const [consentTarget, setConsentTarget] = useState<ConsentTarget | null>(null);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const recipients = useMemo(() => {
    const base: AudienceCustomer[] = selectAll
      ? customers.filter(hasPhone)
      : filtersActive(filters) ? applyFilters(customers, filters) : [];
    const ids = new Set(base.map((c) => c.id));
    const out = [...base];
    for (const id of added) if (!ids.has(id) && byId.has(id)) { out.push(byId.get(id)!); ids.add(id); }
    return out;
  }, [customers, filters, selectAll, added, byId]);

  const included = recipients.filter((c) => !removed.has(c.id));
  const sendable = included.filter((c) => hasPhone(c) && !isExcluded(c));

  const consentCounts = useMemo(() => {
    const m: Record<ConsentStatus, number> = { unknown: 0, opted_in: 0, opted_out: 0 };
    for (const c of customers) m[c.consentStatus]++;
    return m;
  }, [customers]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const d = q.replace(/\D/g, "");
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (d.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(d))).slice(0, 20);
  }, [search, customers]);

  function toggle<T>(arr: T[], v: T) {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function loadSegment(seg: { name: string; filters: unknown; customer_ids: unknown }) {
    const st = seg.filters as Partial<SavedState>;
    setFilters({ ...EMPTY_FILTERS, ...(st.filters ?? {}) });
    setSelectAll(!!st.selectAll);
    setAdded(new Set(st.added ?? []));
    setRemoved(new Set(st.removed ?? []));
    setSegName(seg.name);
    toast.success(`Loaded "${seg.name}"`);
  }

  async function onSave() {
    if (!segName.trim()) return toast.error("Give the audience a name");
    const st: SavedState = { filters, selectAll, added: [...added], removed: [...removed] };
    try {
      await saveFn({ data: { name: segName.trim(), filters: st as unknown as Record<string, unknown>, customerIds: included.map((c) => c.id) } });
      toast.success("Audience saved");
      qc.invalidateQueries({ queryKey: ["marketing-segments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Customers" value={customers.length} />
        <StatTile label="Opted in" value={consentCounts.opted_in} />
        <StatTile label="Consent unknown" value={consentCounts.unknown} />
        <StatTile label="Opted out (never texted)" value={consentCounts.opted_out} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Button
              className="w-full"
              variant={selectAll ? "default" : "outline"}
              onClick={() => setSelectAll((v) => !v)}
            >
              <Users className="mr-2 h-4 w-4" />
              {selectAll ? "All customers selected" : "Select All Customers"}
            </Button>
            <p className="text-xs text-muted-foreground">Adds everyone with a phone number. Filters below narrow the list when this is off.</p>

            <div className="space-y-2">
              <Label>Most recent</Label>
              <Select value={filters.recentMode} onValueChange={(v) => setFilters({ ...filters, recentMode: v as AudienceFilters["recentMode"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any time</SelectItem>
                  <SelectItem value="count">Last N customers</SelectItem>
                  <SelectItem value="days">Created in the last N days</SelectItem>
                </SelectContent>
              </Select>
              {filters.recentMode === "count" && (
                <div className="flex flex-wrap gap-1">
                  {[10, 25, 50].map((n) => (
                    <Button key={n} size="sm" variant={filters.recentCount === n ? "default" : "outline"} onClick={() => setFilters({ ...filters, recentCount: n })}>{n}</Button>
                  ))}
                  <Input className="h-8 w-20" type="number" min={1} value={filters.recentCount} onChange={(e) => setFilters({ ...filters, recentCount: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
              )}
              {filters.recentMode === "days" && (
                <div className="flex flex-wrap gap-1">
                  {[7, 30, 90].map((n) => (
                    <Button key={n} size="sm" variant={filters.recentDays === n ? "default" : "outline"} onClick={() => setFilters({ ...filters, recentDays: n })}>{n} days</Button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Customer type</Label>
              {([["current", "Current (active rental)"], ["past", "Past customers"], ["waitlist", "Waitlist"]] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox checked={filters.statuses.includes(k)} onCheckedChange={() => setFilters({ ...filters, statuses: toggle(filters.statuses, k) })} />{l}
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Lead source</Label>
              {(Object.keys(LEAD_SOURCE_LABEL) as LeadSource[]).filter((k) => k !== "other").map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox checked={filters.leadSources.includes(k)} onCheckedChange={() => setFilters({ ...filters, leadSources: toggle(filters.leadSources, k) })} />{LEAD_SOURCE_LABEL[k]}
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Form visits</Label>
              <Select value={filters.visit} onValueChange={(v) => setFilters({ ...filters, visit: v as AudienceFilters["visit"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="visited">Visited a form</SelectItem>
                  <SelectItem value="visited_not_submitted">Visited but did not submit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2">
              <Checkbox checked={filters.hasPhoneOnly} onCheckedChange={(v) => setFilters({ ...filters, hasPhoneOnly: v === true })} />Has phone number
            </label>

            <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setSelectAll(false); setAdded(new Set()); setRemoved(new Set()); setSegName(""); }}>Clear all</Button>

            <div className="space-y-2 border-t pt-3">
              <Label>Add individual customers</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {searchResults.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={added.has(c.id) || (recipients.some((r) => r.id === c.id) && !removed.has(c.id))}
                    onCheckedChange={(v) => {
                      const a = new Set(added); const r = new Set(removed);
                      if (v === true) { a.add(c.id); r.delete(c.id); } else { a.delete(c.id); r.add(c.id); }
                      setAdded(a); setRemoved(r);
                    }}
                  />
                  {c.name} · {c.phone || "no phone"}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="text-2xl font-bold">{sendable.length}</div>
              <div className="text-sm text-muted-foreground">
                recipients
                {included.length - sendable.length > 0 && ` · ${included.length - sendable.length} will be skipped (opted out / do not text / no phone)`}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Input className="h-9 w-48" placeholder="Audience name" value={segName} onChange={(e) => setSegName(e.target.value)} />
                <Button variant="outline" onClick={onSave} disabled={included.length === 0}>Save audience</Button>
                <Button
                  disabled={sendable.length === 0}
                  onClick={() => onUse({ label: segName.trim() || (selectAll ? "All customers" : "Custom group"), customerIds: included.map((c) => c.id) })}
                >
                  Use in Compose
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="max-h-[520px] overflow-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Consent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Pick filters, search for customers, or click Select All Customers.</TableCell></TableRow>
                  )}
                  {recipients.slice(0, 1000).map((c) => {
                    const off = removed.has(c.id);
                    const excluded = isExcluded(c);
                    return (
                      <TableRow key={c.id} className={off || excluded ? "opacity-50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={!off && !excluded}
                            disabled={excluded}
                            onCheckedChange={(v) => { const r = new Set(removed); if (v === true) r.delete(c.id); else r.add(c.id); setRemoved(r); }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {c.name}
                          {c.kind === "waitlist" && <Badge variant="outline" className="ml-2 text-[10px]">Waitlist</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{c.phone || "—"}</TableCell>
                        <TableCell><LeadSourceBadge source={c.leadSource} /></TableCell>
                        <TableCell>
                          <button type="button" onClick={() => setConsentTarget({ id: c.id, name: c.name, consentStatus: c.consentStatus, consentNote: c.consentNote, doNotText: c.doNotText })}>
                            <ConsentBadge status={c.consentStatus} />
                            {c.doNotText && <Badge variant="destructive" className="ml-1 text-[10px]">Do not text</Badge>}
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {recipients.length > 1000 && <p className="p-3 text-xs text-muted-foreground">Showing first 1,000 of {recipients.length}. All are included.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Saved audiences</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(segQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">None saved yet.</p>}
              {(segQ.data ?? []).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{Array.isArray(s.customer_ids) ? s.customer_ids.length : 0} when saved</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => loadSegment(s)}>Load</Button>
                    <Button size="icon" variant="ghost" aria-label="Delete audience" onClick={async () => { await delFn({ data: { id: s.id } }); qc.invalidateQueries({ queryKey: ["marketing-segments"] }); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
      <ConsentDialog target={consentTarget} onClose={() => setConsentTarget(null)} onSaved={onRefresh} />
      <span className="sr-only">{Object.values(CONSENT_LABEL).join(",")}</span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
