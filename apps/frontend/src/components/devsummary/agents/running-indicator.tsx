import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";

/**
 * A run that has to read commits before it can answer takes seconds. Without an
 * affordance that reads as work rather than a hang, a question over a wide window
 * looks broken.
 *
 * The label lives in a child so it unmounts when the run ends. That resets `slow`
 * without ever calling setState from an effect body.
 */
export const RunningIndicator: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  if (!isRunning) return null;
  return <RunningLabel />;
};

const RunningLabel: FC = () => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <p className="px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
      {slow ? "Reading commits" : "Thinking"}
    </p>
  );
};
