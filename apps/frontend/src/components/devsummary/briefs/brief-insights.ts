import type { BriefCommitTypeCounts } from "@launchstack/api-interfaces";
import {
  CLASSIFIED_COMMIT_TYPES,
  type ClassifiedCommitType,
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

function sentenceCase(s: string): string {
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
