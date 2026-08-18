import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarScope = "projects" | "teams";

interface SidebarPrefsState {
  pinned: Record<SidebarScope, string[]>;
  collapsed: Record<SidebarScope, boolean>;
  togglePin: (scope: SidebarScope, id: string) => void;
  toggleCollapse: (scope: SidebarScope) => void;
  isPinned: (scope: SidebarScope, id: string) => boolean;
}

export const useSidebarPrefs = create<SidebarPrefsState>()(
  persist(
    (set, get) => ({
      pinned: { projects: [], teams: [] },
      collapsed: { projects: false, teams: false },
      togglePin: (scope, id) =>
        set((s) => {
          const list = s.pinned[scope];
          const next = list.includes(id)
            ? list.filter((x) => x !== id)
            : [...list, id];
          return { pinned: { ...s.pinned, [scope]: next } };
        }),
      toggleCollapse: (scope) =>
        set((s) => ({
          collapsed: { ...s.collapsed, [scope]: !s.collapsed[scope] },
        })),
      isPinned: (scope, id) => get().pinned[scope].includes(id),
    }),
    {
      name: "devsummary-sidebar-prefs-v2",
      version: 2,
      migrate: (state) => {
        const legacy = state as
          | { pinned?: Record<string, string[]>; collapsed?: Record<string, boolean> }
          | undefined;
        if (!legacy) return state;
        const pinned = legacy.pinned ?? {};
        const collapsed = legacy.collapsed ?? {};
        return {
          pinned: { projects: pinned.projects ?? [], teams: pinned.teams ?? [] },
          collapsed: {
            projects: collapsed.projects ?? false,
            teams: collapsed.teams ?? false,
          },
        } as unknown as SidebarPrefsState;
      },
    },
  ),
);
