/**
 * Hybrid name matching helpers.
 *
 * Strategy:
 *  1. Exact match (after normalization) → pass.
 *  2. Nickname dictionary match (Larry ↔ Lawrence, Bob ↔ Robert, …) → pass.
 *  3. Otherwise fall back to a fuzzy score:
 *       score >= 0.75  → pass (approved)
 *       0.50 - 0.75    → admin review (pending_review)
 *       < 0.50         → auto-refund (mismatched)
 *
 * Dictionary / exact matches never raise an admin alert.
 */

/** Bidirectional nickname pairs (formal ↔ common short form). */
export const nicknameMap: Record<string, string> = {
  larry: "lawrence",
  lawrence: "larry",
  bob: "robert",
  robert: "bob",
  bill: "william",
  william: "bill",
  jim: "james",
  james: "jim",
  liz: "elizabeth",
  elizabeth: "liz",
  mike: "michael",
  michael: "mike",
  tom: "thomas",
  thomas: "tom",
  joe: "joseph",
  joseph: "joe",
  dan: "daniel",
  daniel: "dan",
  richard: "dick",
  dick: "richard",
  charles: "charlie",
  charlie: "charles",
  christopher: "chris",
  chris: "christopher",
  margaret: "maggie",
  maggie: "margaret",
  patricia: "pat",
  pat: "patricia",
  benjamin: "ben",
  ben: "benjamin",
  // A few more common pairs for good measure.
  jon: "jonathan",
  jonathan: "jon",
  steve: "steven",
  steven: "steve",
  tony: "anthony",
  anthony: "tony",
  ed: "edward",
  edward: "ed",
  andy: "andrew",
  andrew: "andy",
  kate: "katherine",
  katherine: "kate",
  ron: "ronald",
  ronald: "ron",
  greg: "gregory",
  gregory: "greg",
  matt: "matthew",
  matthew: "matt",
  nick: "nicholas",
  nicholas: "nick",
  sam: "samuel",
  samuel: "sam",
};

/** Lowercase, strip accents/punctuation/titles/suffixes, collapse whitespace. */
export function normalizeName(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(mr|mrs|ms|miss|dr|jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((t) => t.length > 1);
}

/** Map a single token through the nickname dictionary (identity if absent). */
function canonical(token: string): string {
  return nicknameMap[token] ?? token;
}

/**
 * Dictionary / exact match check (no fuzzy logic).
 * Returns true when both first and last name tokens match exactly or via the
 * nickname dictionary. Single-token names match on that one token.
 */
export function isNameMatch(name1: string, name2: string): boolean {
  const a = tokens(name1);
  const b = tokens(name2);
  if (!a.length || !b.length) return false;

  // Whole-string equality fast path.
  if (normalizeName(name1) === normalizeName(name2)) return true;

  // Compare first + last tokens, allowing nickname substitution.
  const firstA = canonical(a[0]);
  const firstB = canonical(b[0]);
  const lastA = canonical(a[a.length - 1]);
  const lastB = canonical(b[b.length - 1]);

  const firstMatches = firstA === firstB || a[0] === b[0];
  const lastMatches = lastA === lastB || a[a.length - 1] === b[b.length - 1];

  // Single-token names: only the available token needs to match.
  if (a.length === 1 || b.length === 1) {
    return canonical(a[0]) === canonical(b[0]) || lastA === lastB;
  }
  return firstMatches && lastMatches;
}

/** Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Similarity (0..1) for two tokens via normalized edit distance. */
function tokenSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Fuzzy similarity score (0..1) between two full names. Each token of the
 * shorter name is matched to its best-similarity token in the other name,
 * with nickname-canonicalized exact matches counting as 1.0.
 */
export function fuzzyNameScore(name1: string, name2: string): number {
  const a = tokens(name1);
  const b = tokens(name2);
  if (!a.length || !b.length) return 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let total = 0;
  for (const t of shorter) {
    let best = 0;
    for (const u of longer) {
      const sim = canonical(t) === canonical(u) ? 1 : tokenSimilarity(t, u);
      if (sim > best) best = sim;
    }
    total += best;
  }
  return total / shorter.length;
}

export type NameMatchDecision = {
  /** "approve" | "review" | "refund" */
  action: "approve" | "review" | "refund";
  /** Status to persist on the record. */
  status: "nickname_match" | "approved" | "pending_review" | "mismatched";
  /** 0..1 fuzzy score (1 for dictionary/exact matches). */
  score: number;
  /** Whether to raise an admin dashboard alert. */
  alert: boolean;
};

/**
 * The single source of truth for the hybrid decision.
 * Dictionary/exact → approve (no alert). Otherwise fuzzy thresholds apply.
 * Payments are NEVER auto-refunded: any name mismatch is routed to admin
 * review (alert) so the payment is kept and an admin manually decides whether
 * to keep it or issue a refund.
 */
export function decideNameMatch(cardName: string, licenseName: string): NameMatchDecision {
  if (!cardName || !licenseName) {
    return { action: "review", status: "pending_review", score: 0, alert: true };
  }
  if (isNameMatch(cardName, licenseName)) {
    return { action: "approve", status: "nickname_match", score: 1, alert: false };
  }
  const score = fuzzyNameScore(cardName, licenseName);
  if (score >= 0.75) {
    return { action: "approve", status: "approved", score, alert: false };
  }
  // Previously a score < 0.5 triggered an automatic refund. Auto-refunds are
  // disabled — all mismatches now go to admin review with the payment kept.
  return { action: "review", status: "pending_review", score, alert: true };
}