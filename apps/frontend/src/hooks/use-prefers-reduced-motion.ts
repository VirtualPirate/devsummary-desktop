import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Tracks the OS "reduce motion" setting so ambient animation can be skipped. */
export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return prefersReducedMotion;
}
