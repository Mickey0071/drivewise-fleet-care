// Browser-side draft cache for the Dispute Packet Builder.
// Keys look like camauto_packet_draft_<timestamp>; entries expire after 24h.
import type { PacketDisputeType, PacketViolationItem } from "@/lib/dispute-packets.functions";

const PREFIX = "camauto_packet_draft_";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DRAFTS = 50;

export type LocalPacketDraft = {
  key: string;
  packetId: string | null;
  savedAt: number;
  name: string;
  renterId: string | null;
  renterName: string | null;
  disputeType: PacketDisputeType;
  notes: string | null;
  items: PacketViolationItem[];
};

function safeParse(raw: string | null): LocalPacketDraft | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalPacketDraft;
  } catch {
    return null;
  }
}

export function listLocalDrafts(): LocalPacketDraft[] {
  if (typeof window === "undefined") return [];
  const out: LocalPacketDraft[] = [];
  const now = Date.now();
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const draft = safeParse(window.localStorage.getItem(key));
    if (!draft || now - draft.savedAt > TTL_MS) {
      window.localStorage.removeItem(key);
      continue;
    }
    out.push({ ...draft, key });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveLocalDraft(
  draft: Omit<LocalPacketDraft, "key" | "savedAt"> & { key?: string },
): string {
  if (typeof window === "undefined") return "";
  const key = draft.key ?? `${PREFIX}${Date.now()}`;
  const payload: LocalPacketDraft = { ...draft, key, savedAt: Date.now() };
  window.localStorage.setItem(key, JSON.stringify(payload));
  const all = listLocalDrafts();
  all.slice(MAX_DRAFTS).forEach((d) => window.localStorage.removeItem(d.key));
  return key;
}

export function getLocalDraftByPacketId(packetId: string): LocalPacketDraft | null {
  return listLocalDrafts().find((d) => d.packetId === packetId) ?? null;
}

export function removeLocalDraft(match: { key?: string; packetId?: string }) {
  if (typeof window === "undefined") return;
  listLocalDrafts().forEach((d) => {
    if ((match.key && d.key === match.key) || (match.packetId && d.packetId === match.packetId)) {
      window.localStorage.removeItem(d.key);
    }
  });
}
