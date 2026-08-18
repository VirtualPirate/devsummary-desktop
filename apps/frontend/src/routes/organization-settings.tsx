import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { UpdateOrganizationSchema } from "@launchstack/api-interfaces";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
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
import {
  useCurrentOrganization,
  useDeleteCurrentOrganization,
  useMyOrganizations,
  useUpdateCurrentOrganization,
} from "@/hooks/api/use-organizations";
import { extractErrorMessage } from "@/lib/extract-error";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

/**
 * Rename and delete, and nothing else. There is one local user, so there is no
 * one to invite, no roles to manage and no one to hand ownership to.
 */
export function OrganizationSettingsPage() {
  const navigate = useNavigate();
  const current = useCurrentOrganization();
  const myOrgs = useMyOrganizations();
  const updateOrg = useUpdateCurrentOrganization();
  const deleteOrg = useDeleteCurrentOrganization();
  const clearActive = useActiveOrganizationStore((s) => s.clear);
  const setActive = useActiveOrganizationStore(
    (s) => s.setActiveOrganizationId,
  );

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const org = current.data?.data.organization;
  // Same freshness test as useBootstrapActiveOrganization: React Query serves
  // the cached list first and keeps it while refetching, so a list we haven't
  // fetched during this mount cannot tell "you have no other workspace" from
  // "not loaded yet".
  const listIsFresh = myOrgs.isFetchedAfterMount && !myOrgs.isFetching;

  const handleUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = UpdateOrganizationSchema.safeParse({
      name: name || undefined,
      slug: slug || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    try {
      await updateOrg.mutateAsync(parsed.data);
      setName("");
      setSlug("");
      toast.success("Workspace updated");
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!org || deleteConfirm !== org.name) return;
    // Pick the next workspace here rather than letting
    // useBootstrapActiveOrganization install orgs[0]: staying on this URL would
    // re-render it — live Danger zone included — against a workspace the user
    // never asked for. Await an untrustworthy list instead of reading "no other
    // workspace" out of it, or we strand the user on /organizations/new while
    // the bootstrap re-installs orgs[0] behind them.
    const list = listIsFresh ? myOrgs : await myOrgs.refetch();
    if (!list.isSuccess) {
      toast.error("Couldn't load your workspaces. Try again.");
      return;
    }
    const nextOrgId =
      list.data.data.find((entry) => entry.organization.id !== org.id)
        ?.organization.id ?? null;
    try {
      await deleteOrg.mutateAsync();
      toast.success(`Deleted ${org.name}`);
      if (nextOrgId) {
        setActive(nextOrgId);
        await navigate({ to: "/" });
      } else {
        clearActive();
        await navigate({ to: "/organizations/new" });
      }
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  if (!org) {
    return (
      <>
        <PageHeader
          title="Workspace settings"
          description="Rename this workspace or delete it."
        />
        <SkeletonList rows={2} rowHeight={140} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Rename this workspace or delete it."
      />
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              The name and URL slug this workspace goes by.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleUpdate}>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={org.name}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder={org.slug}
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={updateOrg.isPending}>
                {updateOrg.isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Deleting removes every project, team, schedule, and brief in this
              workspace. This can&apos;t be undone. Type{" "}
              <strong className="text-foreground">{org.name}</strong> to confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={org.name}
            />
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConfirm !== org.name || deleteOrg.isPending}
            >
              {deleteOrg.isPending ? "Deleting…" : "Delete workspace"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
