import { AgentWorkspace } from "@/components/devsummary/agents/agent-workspace";
import { useConnectReposGate } from "@/hooks/use-connect-repos-gate";

export function AgentsPage() {
  // The agent answers from commit history, so it has nothing to say until a
  // repository is being read on some branch. Same gate as every other page.
  const gate = useConnectReposGate();
  if (gate) return gate;

  return <AgentWorkspace />;
}
