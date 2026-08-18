import { useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { CreateOrganizationSchema } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractErrorMessage } from "@/lib/extract-error";
import { useCreateOrganization } from "@/hooks/api/use-organizations";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export function CreateOrganizationPage() {
  const navigate = useNavigate();
  const setActive = useActiveOrganizationStore((s) => s.setActiveOrganizationId);
  const createOrg = useCreateOrganization();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = CreateOrganizationSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    try {
      const result = await createOrg.mutateAsync(parsed.data);
      setActive(result.data.id);
      await navigate({ to: "/" });
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand/12">
            <Building2 className="size-6 text-brand" />
          </div>
          <CardTitle>Create organization</CardTitle>
          <CardDescription>
            You&apos;ll be the owner and can invite teammates once it&apos;s set
            up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc"
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={createOrg.isPending}>
              {createOrg.isPending ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
