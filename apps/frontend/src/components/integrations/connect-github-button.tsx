import { GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStartGithubConnect } from "@/hooks/api/use-github-integrations"

export function ConnectGithubButton() {
  const mutation = useStartGithubConnect()

  return (
    <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      <GitBranch className="size-4" />
      {mutation.isPending ? "Redirecting…" : "Connect GitHub"}
    </Button>
  )
}
