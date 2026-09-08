/** Shared by the key-provider card on the AI page and by `AgentCliCard`. A
 *  provider card is an `<article>` on the configured page and a `<button>` in
 *  the first-run picker, so its surface classes live here rather than in `Card`. */
export const PROVIDER_CARD =
  "flex flex-col gap-4 rounded-lg border bg-card px-5 py-[1.125rem] shadow-e1";
export const PROVIDER_CARD_SELECTED = "border-brand ring-1 ring-brand";

export const BADGE = "gap-1.5 rounded-full px-2.5";
export const TONE = {
  brand: "bg-brand/14 text-brand",
  ok: "bg-gb-status-shipped/15 text-gb-status-shipped",
  mute: "bg-muted text-muted-foreground",
  warn: "bg-gb-status-at-risk/18 text-gb-status-at-risk",
};
