import { useState } from "react";

import { BraidBusBackdrop } from "./braid-bus-backdrop";
import { BraidFanBackdrop } from "./braid-fan-backdrop";
import { BraidMarkBackdrop } from "./braid-mark-backdrop";

export const AUTH_BACKDROP_VARIANTS = ["mark", "fan", "bus"] as const;

export type AuthBackdropVariant = (typeof AUTH_BACKDROP_VARIANTS)[number];

export function AuthBackdrop({ variant }: { variant: AuthBackdropVariant }) {
  if (variant === "mark") return <BraidMarkBackdrop />;
  if (variant === "fan") return <BraidFanBackdrop />;
  return <BraidBusBackdrop />;
}

/** Picks one backdrop per mount, so an auth page is never twice the same. */
export function RandomAuthBackdrop() {
  const [variant] = useState<AuthBackdropVariant>(
    () =>
      AUTH_BACKDROP_VARIANTS[
        Math.floor(Math.random() * AUTH_BACKDROP_VARIANTS.length)
      ],
  );

  return <AuthBackdrop variant={variant} />;
}
