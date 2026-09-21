/**
 * Drop the Markdown markers the consent dialog's block renderer does not itself
 * render (`legal-dialog.tsx`). Its own file so the check harness beside it can
 * run under node — `legal-dialog.tsx` imports the documents with Vite's `?raw`,
 * which esbuild has no loader for.
 */
export function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [the Software](#software)
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*+/g, "") // **bold** and ***bold italic*** alike
    .replace(/^>\s?/gm, "") // the license's indented examples
    .replace(/\s*\n\s*/g, " ")
    .trim()
}
