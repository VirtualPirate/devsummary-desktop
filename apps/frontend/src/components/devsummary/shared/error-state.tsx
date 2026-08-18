import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 py-12 text-center">
      <AlertTriangle className="size-5 text-destructive" />
      <div className="text-sm font-medium">{title}</div>
      {message ? (
        <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { extractErrorMessage } from "@/lib/extract-error";
