import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("mb-8", className)}>{children}</section>;
}
