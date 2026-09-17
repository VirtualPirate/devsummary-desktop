/**
 * Run from apps/frontend with:
 *   esbuild src/components/consent/legal-markdown.check.ts --bundle --format=esm \
 *     --platform=node --alias:@=./src --outfile=/tmp/c.mjs && node /tmp/c.mjs
 *
 * What is pinned: the two documents the consent dialog renders come out of
 * `plain` with no Markdown syntax left in them. These are the terms a user is
 * asked to accept, and they are read in a dialog that has no other renderer —
 * a stray `***` or `[text](#anchor)` is shipped text, not a formatting nit.
 * The real files are read off disk, so adding a construct to either document
 * that the renderer cannot handle fails here rather than on screen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { plain } from "./legal-markdown.ts";

assert.equal(plain("The **licensor** grants"), "The licensor grants");
assert.equal(plain("***as is***, without"), "as is, without");
assert.equal(plain("see [Noncompete](#noncompete) for"), "see Noncompete for");
assert.equal(plain("a `Required Notice:` line"), "a Required Notice: line");
assert.equal(plain("> Required Notice: Copyright"), "Required Notice: Copyright");
assert.equal(plain("<https://example.com>"), "https://example.com");
assert.equal(plain("wrapped\n  across lines"), "wrapped across lines");

// Windows paths survive: PRIVACY.md names %APPDATA%\DevSummary.
assert.equal(plain("`%APPDATA%\\DevSummary`"), "%APPDATA%\\DevSummary");

const root = path.resolve(process.cwd(), "..", "..");
for (const name of ["LICENSE", "PRIVACY.md"]) {
  const file = path.join(root, name);
  const blocks = readFileSync(file, "utf8").split(/\n{2,}/);
  assert.ok(blocks.length > 5, `${name} did not read from ${root}`);

  for (const block of blocks) {
    // Headings and bullets are rendered as elements, not passed through plain().
    if (/^#{1,6}\s/.test(block) || block.startsWith("- ")) continue;
    const rendered = plain(block);
    for (const marker of ["*", "`", "](", "\n"]) {
      assert.ok(
        !rendered.includes(marker),
        `${name}: ${JSON.stringify(marker)} survives into the dialog — ${rendered.slice(0, 80)}`,
      );
    }
  }
}

console.log("[legal-markdown] ok");
