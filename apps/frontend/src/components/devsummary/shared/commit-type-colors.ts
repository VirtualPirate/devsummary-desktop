import {
  WORK_CATEGORIES,
  WORK_CATEGORY_LABEL,
  WORK_CATEGORY_OF,
  type BriefCommitType,
  type WorkCategory,
} from "@launchstack/api-interfaces";

export type ClassifiedCommitType = Exclude<BriefCommitType, "unclassified">;

/** Canonical display order; also the tiebreak when counts are equal. */
export const CLASSIFIED_COMMIT_TYPES: ClassifiedCommitType[] = [
  "feature",
  "fix",
  "optimization",
  "refactor",
  "docs",
  "test",
  "chore",
];

// Tailwind needs literal class names, so the type -> class mapping is
// spelled out rather than interpolated.
export const COMMIT_TYPE_BG_CLASS: Record<ClassifiedCommitType, string> = {
  feature: "bg-gb-chart-feature",
  fix: "bg-gb-chart-bug",
  optimization: "bg-gb-chart-optimization",
  refactor: "bg-gb-chart-refactor",
  docs: "bg-gb-chart-docs",
  test: "bg-gb-chart-test",
  chore: "bg-gb-chart-chore",
};

// Raw CSS variables for consumers (recharts props) that need color values
// rather than Tailwind classes. Resolved at paint time, so dark mode just
// works.
export const COMMIT_TYPE_CSS_VAR: Record<ClassifiedCommitType, string> = {
  feature: "var(--gb-chart-feature)",
  fix: "var(--gb-chart-bug)",
  optimization: "var(--gb-chart-optimization)",
  refactor: "var(--gb-chart-refactor)",
  docs: "var(--gb-chart-docs)",
  test: "var(--gb-chart-test)",
  chore: "var(--gb-chart-chore)",
};

// Soft tinted pill styling (low-alpha fill + full-strength text) for the
// plain-English work tags on brief cards. Literal class strings so Tailwind's
// scanner keeps them. The alpha tint reads as a pastel in light mode and a
// muted glow in dark mode from the same token.
export const COMMIT_TYPE_TINT_CLASS: Record<ClassifiedCommitType, string> = {
  feature: "bg-gb-chart-feature/12 text-gb-chart-feature",
  fix: "bg-gb-chart-bug/12 text-gb-chart-bug",
  optimization: "bg-gb-chart-optimization/12 text-gb-chart-optimization",
  refactor: "bg-gb-chart-refactor/12 text-gb-chart-refactor",
  docs: "bg-gb-chart-docs/12 text-gb-chart-docs",
  test: "bg-gb-chart-test/12 text-gb-chart-test",
  chore: "bg-gb-chart-chore/12 text-gb-chart-chore",
};

/** Chart colours. Five slots, fixed order, never cycled. */
export const WORK_CATEGORY_CSS_VAR: Record<WorkCategory, string> = {
  feature: "var(--gb-chart-feature)",
  fix: "var(--gb-chart-bug)",
  optimization: "var(--gb-chart-optimization)",
  refactor: "var(--gb-chart-refactor)",
  upkeep: "var(--gb-chart-chore)",
};

// Tailwind needs literal class names, so the mapping is spelled out.
export const WORK_CATEGORY_BG_CLASS: Record<WorkCategory, string> = {
  feature: "bg-gb-chart-feature",
  fix: "bg-gb-chart-bug",
  optimization: "bg-gb-chart-optimization",
  refactor: "bg-gb-chart-refactor",
  upkeep: "bg-gb-chart-chore",
};

export const WORK_CATEGORY_TINT_CLASS: Record<WorkCategory, string> = {
  feature: "bg-gb-chart-feature/12 text-gb-chart-feature",
  fix: "bg-gb-chart-bug/12 text-gb-chart-bug",
  optimization: "bg-gb-chart-optimization/12 text-gb-chart-optimization",
  refactor: "bg-gb-chart-refactor/12 text-gb-chart-refactor",
  upkeep: "bg-gb-chart-chore/12 text-gb-chart-chore",
};

/** Diverging pair for the churn chart. */
export const CHURN_CSS_VAR = {
  added: "var(--gb-chart-bug)",
  removed: "var(--gb-chart-risk)",
} as const;

// Re-exported so report components import colours and vocabulary from one place.
export { WORK_CATEGORIES, WORK_CATEGORY_LABEL, WORK_CATEGORY_OF };
export type { WorkCategory, BriefCommitType };
