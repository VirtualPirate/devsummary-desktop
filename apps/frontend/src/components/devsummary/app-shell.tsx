import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBootstrapActiveOrganization } from "@/hooks/use-bootstrap-active-organization";
import { Topbar } from "./topbar/topbar";
import { SidebarNav } from "./sidebar/sidebar-nav";
import { BackgroundJobsToast } from "./background-jobs-toast";

export function AppShell() {
  useBootstrapActiveOrganization();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <div className="md:hidden absolute left-3 top-2 z-30">
          <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)}>
            {open ? <X /> : <Menu />}
          </Button>
        </div>
        <aside
          className={`${
            open ? "translate-x-0" : "-translate-x-full"
          } fixed inset-y-12 left-0 z-10 w-60 border-r bg-sidebar transition-transform md:static md:translate-x-0`}
        >
          <SidebarNav />
        </aside>
        {open ? (
          <div className="fixed inset-0 z-[9] bg-black/40 md:hidden" onClick={() => setOpen(false)} />
        ) : null}
        <main className="relative flex-1 overflow-y-auto">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_55%_60%_at_50%_-25%,var(--brand),transparent_70%)] opacity-[0.05]"
          />
          <div className="relative mx-auto w-full max-w-6xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <BackgroundJobsToast />
    </div>
  );
}
