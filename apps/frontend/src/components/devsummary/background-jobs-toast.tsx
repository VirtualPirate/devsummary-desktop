import { useEffect, useId, useMemo, useState } from "react";

import type { JobActivityResponse } from "@launchstack/api-interfaces";
import { useJobActivity } from "@/hooks/api/use-jobs";
import { BrandMarkLoader } from "./brand-mark-loader";

type PhaseKey = Extract<
  keyof JobActivityResponse,
  "fetching" | "analyzing" | "generating"
>;

// Pipeline order — the order active phases are cycled through in the toast.
const PHASES: ReadonlyArray<{ key: PhaseKey; label: string }> = [
  { key: "fetching", label: "Fetching commits" },
  { key: "analyzing", label: "Analyzing commits" },
  { key: "generating", label: "Generating summaries" },
];

const CYCLE_MS = 2600;

/**
 * Bottom-right toast shown while background jobs run for the active org.
 * Reflects the real pipeline phase(s) from `GET .../jobs/activity`: shows the
 * single active phase, or cycles through several when more than one is live.
 * Renders nothing when idle.
 */
export function BackgroundJobsToast() {
  const { data } = useJobActivity();
  const activity = data?.data;

  const labels = useMemo(
    () =>
      activity
        ? PHASES.filter((p) => (activity[p.key] ?? 0) > 0).map((p) => p.label)
        : [],
    [activity],
  );

  const [tick, setTick] = useState(0);

  // Advance only while more than one phase is active. The interval re-keys on
  // labels.length so the modulo base always matches the current active set.
  useEffect(() => {
    if (labels.length <= 1) return;
    const id = setInterval(() => setTick((v) => v + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [labels.length]);

  const uid = useId();
  const ns = `bjt-${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (labels.length === 0) return null;

  const label = labels[tick % labels.length];

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex justify-end"
      role="status"
      aria-live="polite"
    >
      <div className="animate-in fade-in slide-in-from-bottom-4 pointer-events-auto relative flex min-w-[260px] max-w-sm items-center gap-3 overflow-hidden rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-lg duration-300">
        <style>{`
          .${ns}-bar {
            position: absolute; top: 0; left: -40%; height: 2px; width: 40%;
            background: linear-gradient(90deg, transparent, var(--brand), transparent);
            animation: ${ns}-sweep 1.6s ease-in-out infinite;
          }
          @keyframes ${ns}-sweep { 0% { left: -40%; } 100% { left: 100%; } }
          @media (prefers-reduced-motion: reduce) {
            .${ns}-bar { animation: none; left: 0; width: 100%; opacity: .5; }
          }
        `}</style>
        <span className={`${ns}-bar`} aria-hidden />
        <BrandMarkLoader className="h-7" />
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.13em] text-muted-foreground">
            Background jobs
          </span>
          <span
            key={label}
            className="animate-in fade-in slide-in-from-bottom-1 truncate text-sm font-semibold duration-300"
          >
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
