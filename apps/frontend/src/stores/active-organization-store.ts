import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ActiveOrganizationState {
  activeOrganizationId: string | null;
  setActiveOrganizationId: (id: string | null) => void;
  clear: () => void;
}

export const useActiveOrganizationStore = create<ActiveOrganizationState>()(
  persist(
    (set) => ({
      activeOrganizationId: null,
      setActiveOrganizationId: (id) => set({ activeOrganizationId: id }),
      clear: () => set({ activeOrganizationId: null }),
    }),
    { name: "launchstack.activeOrganization" },
  ),
);
