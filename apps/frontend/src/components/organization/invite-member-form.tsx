import { useState } from "react";
import { CreateInviteSchema, type InviteRole } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateInvite } from "@/hooks/api/use-invites";

export function InviteMemberForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const createInvite = useCreateInvite();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const parsed = CreateInviteSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    try {
      await createInvite.mutateAsync(parsed.data);
      setSuccess(`Invite sent to ${parsed.data.email}`);
      setEmail("");
      setRole("viewer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send invite");
    }
  };

  return (
    <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          required
        />
      </div>
      <div className="w-full md:w-40 space-y-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
          <SelectTrigger id="invite-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={createInvite.isPending}>
        {createInvite.isPending ? "Sending…" : "Send invite"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive md:basis-full" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-gb-status-shipped md:basis-full" role="status">
          {success}
        </p>
      ) : null}
    </form>
  );
}
