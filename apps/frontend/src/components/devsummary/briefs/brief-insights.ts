import type {
  BriefCommitTypeCounts,
  BriefHighlight,
} from "@launchstack/api-interfaces";
import {
  CLASSIFIED_COMMIT_TYPES,
  WORK_CATEGORIES,
  type ClassifiedCommitType,
  type WorkCategory,
} from "@/components/devsummary/shared/commit-type-colors";

// Executive-facing phrasing for each work type: [singular, plural]. The raw
// commit_type enum (feature | fix | …) is engineering vocabulary; briefs are
// read by founders and PMs, so surface plain language instead.
export const WORK_TYPE_LABEL: Record<ClassifiedCommitType, [string, string]> = {
  feature: ["new feature", "new features"],
  fix: ["fix", "fixes"],
  optimization: ["speed-up", "speed-ups"],
  refactor: ["cleanup", "cleanups"],
  docs: ["doc update", "doc updates"],
  test: ["test", "tests"],
  chore: ["chore", "chores"],
};

export interface WorkTag {
  key: ClassifiedCommitType;
  count: number;
  /** e.g. "12 new features" */
  label: string;
  /** e.g. "New features" — the category name alone, sentence-cased. */
  category: string;
}

function pluralize(key: ClassifiedCommitType, count: number): string {
  const [one, many] = WORK_TYPE_LABEL[key];
  return `${count} ${count === 1 ? one : many}`;
}

export function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Classified work types present in the brief, richest first. Unclassified
 * commits are intentionally omitted — there's nothing plain-English to say
 * about them. `CLASSIFIED_COMMIT_TYPES` order is the stable tiebreak.
 */
export function workBreakdown(counts: BriefCommitTypeCounts): WorkTag[] {
  return CLASSIFIED_COMMIT_TYPES.filter((k) => counts[k] > 0)
    .map((k) => ({
      key: k,
      count: counts[k],
      label: pluralize(k, counts[k]),
      category: sentenceCase(WORK_TYPE_LABEL[k][1]),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Top `max` work tags for compact display in a feed card. */
export function workTags(counts: BriefCommitTypeCounts, max = 4): WorkTag[] {
  return workBreakdown(counts).slice(0, max);
}

/**
 * Split a summary into a lead sentence (used as a standfirst / card lede) and
 * the remaining body. Falls back to the whole string as the lead when there's
 * only one sentence.
 */
export function splitSummary(summary: string): { lead: string; body: string } {
  const trimmed = (summary ?? "").trim();
  if (!trimmed) return { lead: "", body: "" };
  const m = trimmed.match(/^([\s\S]+?[.!?])\s+([\s\S]+)$/);
  if (!m) return { lead: trimmed, body: "" };
  return { lead: m[1].trim(), body: m[2].trim() };
}

/** "5 people" / "1 person" from a contributor count. */
export function contributorLabel(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

export interface HighlightTagCount {
  category: WorkCategory;
  count: number;
}

/**
 * Categories present in a highlight list, with their counts, in
 * `WORK_CATEGORIES` order.
 *
 * The order is the chart's, not the ranking's, on purpose: these become the
 * filter chips, and a chip row that reshuffles between briefs is a row nobody
 * builds muscle memory for. Highlights with no category — every brief
 * generated before the field existed — are counted by nothing and so appear in
 * no chip, which is why `canFilterHighlights` refuses to offer filtering at all
 * unless every highlight carries one.
 */
export function highlightTagCounts(
  highlights: BriefHighlight[],
): HighlightTagCount[] {
  const totals = new Map<WorkCategory, number>();
  for (const h of highlights) {
    if (!h.category) continue;
    totals.set(h.category, (totals.get(h.category) ?? 0) + 1);
  }
  return WORK_CATEGORIES.filter((c) => totals.has(c)).map((c) => ({
    category: c,
    count: totals.get(c) as number,
  }));
}

/**
 * Whether the chip row earns its place. Two conditions, each with a screen in
 * the design demo behind it: a single category means a control that cannot
 * change anything, and a partially tagged list means filtering would silently
 * strip the untagged highlights with no chip to bring them back.
 */
export function canFilterHighlights(highlights: BriefHighlight[]): boolean {
  return (
    highlightTagCounts(highlights).length >= 2 &&
    highlights.every((h) => h.category)
  );
}
