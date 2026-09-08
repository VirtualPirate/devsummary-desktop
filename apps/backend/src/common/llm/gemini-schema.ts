import { z } from 'zod';

/**
 * The JSON-Schema keywords Gemini's `responseSchema` accepts. Its OpenAI
 * compatibility layer maps `response_format.json_schema.schema` onto that type
 * and rejects the request outright on anything outside this set — including
 * `additionalProperties`, `minLength`/`maxLength` and `$schema`, all of which
 * `z.toJSONSchema` emits for the brief and commit-analysis schemas.
 *
 * Dropping the string-length bounds costs nothing: the response is still
 * `safeParse`d against the full Zod schema on the way back, so a model that
 * overruns a `.max(120)` fails there exactly as it would have on OpenAI.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'nullable',
  'anyOf',
  'minItems',
  'maxItems',
]);

function prune(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(prune);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    // Under `properties`, the keys are user field names — a field called
    // "type" or "required" must not be filtered as if it were a keyword.
    out[key] =
      key === 'properties' && value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [
              k,
              prune(v),
            ]),
          )
        : prune(value);
  }
  return out;
}

export function toGeminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return prune(
    z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }),
  ) as Record<string, unknown>;
}
