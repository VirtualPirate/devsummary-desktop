import { Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Green tick when a credential is stored. Never the value — only the boolean. */
function StatusPill({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gb-status-shipped/15 px-2.5 py-0.5 text-xs font-medium text-gb-status-shipped">
      <Check className="size-3" />
      Configured
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      Not set
    </span>
  );
}

/** Credential card with a configured/not-set pill. Shared by settings and the
 * AI integration page — both show "is this credential stored" and nothing more. */
export function SectionCard({
  title,
  description,
  configured,
  children,
}: {
  title: string;
  description: React.ReactNode;
  configured: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <StatusPill configured={configured} />
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
