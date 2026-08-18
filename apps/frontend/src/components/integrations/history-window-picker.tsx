import type { GithubLookbackDays } from "@launchstack/api-interfaces"
import { Check, Clock } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { HISTORY_WINDOWS } from "@/lib/history-window"
import { cn } from "@/lib/utils"

/** One window for the whole batch — not per repository. */
export function HistoryWindowPicker({
  value,
  onChange,
  disabled,
}: {
  value: GithubLookbackDays
  onChange: (days: GithubLookbackDays) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          size="sm"
          disabled={disabled}
          className="h-auto p-0 text-xs font-semibold text-brand"
        >
          Change
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5 text-sm text-muted-foreground">
          <Clock className="size-4" />
          How far back should we read?
        </div>
        <div className="p-1">
          {HISTORY_WINDOWS.map((window) => (
            <button
              key={window.days}
              type="button"
              onClick={() => {
                onChange(window.days)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition hover:bg-accent",
                value === window.days && "bg-brand/10",
              )}
            >
              <Check
                className={cn(
                  "mt-0.5 size-3.5 text-brand",
                  value === window.days ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm">{window.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {window.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Every commit is analyzed once. A wider window costs more up front and
          nothing after.
        </p>
      </PopoverContent>
    </Popover>
  )
}
