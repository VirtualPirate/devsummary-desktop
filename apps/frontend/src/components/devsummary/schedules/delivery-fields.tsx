import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, ChevronDown, Hash, Lock, X } from "lucide-react";
import type { DeliveryInput, SlackChannel } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useJoinSlackChannel, useSlackChannels } from "@/hooks/api/use-slack";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";

function Chip({ label, onRemove, removeLabel }: { label: React.ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-3 pr-1.5 text-xs font-medium">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="grid size-4 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * Channel picker over the live `conversations.list`. The field used to take a
 * raw channel ID, which meant copying `C0123ABCDEF` out of Slack's About panel
 * and finding out it was wrong when the first brief failed to deliver.
 */
function SlackChannelPicker({
  value,
  onSelect,
  onClear,
  channels,
  isLoading,
}: {
  value: string | undefined;
  onSelect: (channelId: string) => void;
  onClear: () => void;
  channels: SlackChannel[];
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const join = useJoinSlackChannel();
  const selected = channels.find((channel) => channel.id === value) ?? null;

  return (
    <>
      <div className="mt-2 flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={isLoading}
              className={cn(
                "h-9 min-w-0 flex-1 justify-between gap-2 sm:max-w-80",
                !value && "font-normal text-muted-foreground",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {selected?.isPrivate ? (
                  <Lock className="size-3.5 shrink-0" />
                ) : (
                  <Hash className="size-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {isLoading
                    ? "Loading channels…"
                    : (selected?.name ??
                      // An existing schedule can point at a channel the bot can
                      // no longer see; show the stored id rather than "none".
                      value ??
                      "Choose a channel")}
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-72 p-0">
            {isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
              </div>
            ) : (
              <Command>
                <CommandInput placeholder={`Filter ${channels.length} channels…`} />
                <CommandList>
                  <CommandEmpty>No channel matches.</CommandEmpty>
                  {channels.map((channel) => (
                    <CommandItem
                      key={channel.id}
                      value={channel.name}
                      onSelect={() => {
                        onSelect(channel.id);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      {channel.isPrivate ? (
                        <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                      {channel.id === value ? (
                        <Check className="size-3.5 shrink-0 text-brand" />
                      ) : channel.memberCount !== null ? (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {channel.memberCount}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>

        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground"
            onClick={onClear}
            aria-label="Remove Slack channel"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      {selected && !selected.isMember ? (
        <div className="mt-2 flex flex-wrap items-start gap-2 rounded-xl border border-gb-status-at-risk/35 bg-gb-status-at-risk/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gb-status-at-risk" />
          <span className="min-w-40 flex-1">
            <strong className="font-semibold">
              @DevSummary isn&rsquo;t in #{selected.name}.
            </strong>{" "}
            {selected.isPrivate ? (
              <>
                Run <span className="font-mono">/invite @DevSummary</span> in Slack — a
                private channel can&rsquo;t be joined from here.
              </>
            ) : (
              "Delivery will fail until it joins."
            )}
          </span>
          {selected.isPrivate ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => join.mutate(selected.id)}
              disabled={join.isPending}
            >
              {join.isPending ? "Joining…" : "Join channel"}
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}

export function DeliveryFields({
  delivery,
  onChange,
  slackAvailable,
}: {
  delivery: DeliveryInput;
  onChange: (next: DeliveryInput) => void;
  slackAvailable: boolean;
}) {
  const [slackDraft, setSlackDraft] = useState("");
  const channelsQuery = useSlackChannels({ enabled: slackAvailable });

  const commitSlack = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    onChange({ ...delivery, slackChannelId: value });
    setSlackDraft("");
  };

  const clearSlack = () => onChange({ ...delivery, slackChannelId: undefined });

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="delivery-slack" className="text-xs">
          Slack channel
        </Label>

        {!slackAvailable ? (
          <>
            {delivery.slackChannelId ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip
                  label={<span className="font-mono">{delivery.slackChannelId}</span>}
                  onRemove={clearSlack}
                  removeLabel="Remove Slack channel"
                />
              </div>
            ) : (
              <Input id="delivery-slack" className="mt-2" placeholder="Channel ID" disabled />
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              <Link to="/integrations/slack" className="underline underline-offset-2">
                Connect Slack
              </Link>{" "}
              to enable Slack delivery.
            </p>
          </>
        ) : channelsQuery.isError ? (
          // The list needs `channels:read`/`groups:read`; an older install may
          // not have granted them. Fall back to the raw ID rather than making
          // Slack delivery unreachable.
          <>
            {delivery.slackChannelId ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip
                  label={<span className="font-mono">{delivery.slackChannelId}</span>}
                  onRemove={clearSlack}
                  removeLabel="Remove Slack channel"
                />
              </div>
            ) : (
              <Input
                id="delivery-slack"
                className="mt-2"
                placeholder="Channel ID, e.g. C0123ABCDEF"
                value={slackDraft}
                onChange={(e) => setSlackDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSlack(slackDraft);
                  }
                }}
                onBlur={() => commitSlack(slackDraft)}
              />
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Couldn&rsquo;t load the channel list ({extractErrorMessage(channelsQuery.error)}).
              Paste a channel ID instead, or reconnect on the{" "}
              <Link to="/integrations/slack" className="underline underline-offset-2">
                Slack integration page
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <SlackChannelPicker
              value={delivery.slackChannelId ?? undefined}
              onSelect={(channelId) => onChange({ ...delivery, slackChannelId: channelId })}
              onClear={clearSlack}
              channels={channelsQuery.data?.data ?? []}
              isLoading={channelsQuery.isPending}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Only channels @DevSummary can see are listed. Private ones need an{" "}
              <span className="font-mono">/invite @DevSummary</span> in Slack first.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
