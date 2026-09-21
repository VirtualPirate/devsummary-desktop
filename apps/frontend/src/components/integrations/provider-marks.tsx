/** Brand marks. lucide-react dropped brand icons in v1, so they live here. */

export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * Placeholder ring, **not** OpenAI's official logomark — the approved design
 * draws it this way on purpose and inventing the real path was out of scope.
 */
export function OpenAiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
      className={className}
    >
      <path d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3z" />
      <path d="M12 7.6 15.8 9.8v4.4L12 16.4 8.2 14.2V9.8z" />
    </svg>
  );
}

/** Gemini's four-point star, the real mark. */
export function GeminiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 1.8c0 5.4 4.8 10.2 10.2 10.2-5.4 0-10.2 4.8-10.2 10.2 0-5.4-4.8-10.2-10.2-10.2C7.2 12 12 7.2 12 1.8Z" />
    </svg>
  );
}

/**
 * Placeholder burst, **not** Anthropic's official logomark — same call as
 * `OpenAiMark`: the approved design draws a simple stroked mark and inventing
 * the real path was out of scope.
 */
export function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d="M12 3.2v17.6M4.4 7.6l15.2 8.8M4.4 16.4l15.2-8.8" />
    </svg>
  );
}

/**
 * A terminal prompt, not OpenCode's official logomark — same call as the two
 * above: the card draws a simple stroked mark and no external asset is worth
 * shipping for it.
 */
export function OpenCodeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M6.2 8.4 10 12l-3.8 3.6M12.8 15.8h5" />
    </svg>
  );
}

/**
 * A cursor pointer, not Cursor's official logomark — same call as the other
 * CLI cards: a simple stroked mark avoids shipping an external brand asset.
 */
export function CursorMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M5.2 3.4 18.8 12l-6.2 1.2-3.2 5.4z" />
    </svg>
  );
}

/**
 * A chevron in a box — a terminal, not Codex's official logomark; same call as
 * the other CLI cards, which avoid shipping an external brand asset.
 */
export function CodexMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4" />
      <path d="M8 10.2 10.6 12 8 13.8M12.8 14.6h3.4" />
    </svg>
  );
}
