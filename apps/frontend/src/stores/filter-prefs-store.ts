import { create } from "zustand";
import { persist } from "zustand/middleware";

/** One entry per filterable list page. */
export type FilterKey = "home" | "briefs";

export type SavedFilters = Record<string, string | number | boolean>;

interface FilterPrefsState {
  filters: Partial<Record<FilterKey, SavedFilters>>;
  save: (key: FilterKey, value: SavedFilters) => void;
}

/**
 * The URL stays the source of truth for filters; this only remembers the last set
 * the user picked, so entering a page with nothing selected (sidebar link, fresh
 * tab, post-login redirect) can re-apply it instead of silently resetting.
 */
export const useFilterPrefs = create<FilterPrefsState>()(
  persist(
    (set) => ({
      filters: {},
      save: (key, value) =>
        set((s) => ({ filters: { ...s.filters, [key]: narrowing(value) } })),
    }),
    { name: "devsummary-filter-prefs-v1" },
  ),
);

/**
 * Drop values that narrow nothing ("", false, 0), so a page with no filters
 * selected stores nothing and restores to a clean URL. `undefined` = no filters.
 */
export function narrowing(value: SavedFilters): SavedFilters | undefined {
  const kept = Object.entries(value).filter(
    ([, v]) => v !== "" && v !== false && v !== 0,
  );
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * Only ever called from a filter change handler — an explicit user action. The
 * store is never written on plain page entry, so a restore that doesn't land
 * can't erase what the user picked.
 */
export function saveFilters(key: FilterKey, value: SavedFilters) {
  useFilterPrefs.getState().save(key, value);
}

/**
 * What a page entered with `current` filters should restore, or `undefined` when
 * the URL already narrows something (explicit URLs, links and bookmarks win) or
 * nothing was ever saved.
 */
export function filtersToRestore(
  key: FilterKey,
  current: SavedFilters,
): SavedFilters | undefined {
  if (narrowing(current)) return undefined;
  return useFilterPrefs.getState().filters[key];
}

/**
 * The filter subset of each page's search params, with defaults blanked so they
 * count as "narrows nothing". Shared by the save handlers and the route loaders
 * so both sides agree on what an unfiltered page looks like.
 */
export const homeFilterPrefs = (s: {
  range: string;
  repo: string;
  collaborator: string;
}): SavedFilters => ({
  range: s.range === "30d" ? "" : s.range,
  repo: s.repo,
  collaborator: s.collaborator,
});

export const briefFilterPrefs = (s: {
  filterType: string;
  from: string;
  to: string;
  scopeId: string;
  excludeNoActivity: boolean;
}): SavedFilters => ({
  filterType: s.filterType === "all" ? "" : s.filterType,
  from: s.from,
  to: s.to,
  scopeId: s.scopeId,
  excludeNoActivity: s.excludeNoActivity,
});
