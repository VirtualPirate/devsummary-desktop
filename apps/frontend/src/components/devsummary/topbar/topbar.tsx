import { OrgSwitcher } from "@/components/organization/org-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BrandMark } from "../brand-mark";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md backdrop-saturate-150">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <BrandMark className="h-4" />
          <span className="text-sm font-semibold tracking-tight text-foreground">DevSummary</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <OrgSwitcher />
      </div>

      <div className="flex items-center gap-1.5">
        <ThemeToggle />
      </div>
    </header>
  );
}
