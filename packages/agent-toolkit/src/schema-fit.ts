/**
 * Fits a job type's params schema into a model's context. Most schemas are a
 * few KB and pass whole. compose's is about 150 KB (some 38,000 tokens), which
 * would crowd out the conversation, so it is shortened in steps: descriptions
 * cut to their first sentence, then descriptions dropped and the deepest
 * levels left out. `list_job_types` with `full: true` returns it whole.
 */
import type { JsonValue } from "./results.js";

// About 4,000 tokens. A bound on model context, not on what Rendobar accepts.
const SCHEMA_BUDGET_CHARS = 16_000;
// No schema nests deeper than this, so the outline search starts here.
const MAX_OUTLINE_DEPTH = 12;

type Fitted = { params: JsonValue; trimmed?: "descriptions" | "outline" };

const fits = (value: JsonValue) => JSON.stringify(value).length <= SCHEMA_BUDGET_CHARS;

/** Rebuilds a schema, letting `entry` rewrite or drop (undefined) each key of each object. */
function mapEntries(value: JsonValue, entry: (key: string, child: JsonValue) => JsonValue | undefined): JsonValue {
  if (Array.isArray(value)) return value.map((v) => mapEntries(v, entry));
  if (value === null || typeof value !== "object") return value;
  const out: { [key: string]: JsonValue } = {};
  for (const [key, child] of Object.entries(value)) {
    const next = entry(key, child);
    if (next !== undefined) out[key] = mapEntries(next, entry);
  }
  return out;
}

const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text;

/** The schema with every object below `depth` reduced to its `type`, `$ref` or `enum`, whichever it has. */
function outline(value: JsonValue, depth: number): JsonValue {
  if (Array.isArray(value)) return value.map((v) => outline(v, depth));
  if (value === null || typeof value !== "object") return value;
  if (depth === 0) {
    const kept: { [key: string]: JsonValue } = {};
    for (const key of ["type", "$ref", "enum", "const"]) {
      const v = value[key];
      if (v !== undefined) kept[key] = v;
    }
    return kept;
  }
  const out: { [key: string]: JsonValue } = {};
  for (const [key, child] of Object.entries(value)) out[key] = outline(child, depth - 1);
  return out;
}

export function fitSchema(schema: JsonValue): Fitted {
  const bare = mapEntries(schema, (key, child) => (key === "$schema" ? undefined : child));
  if (fits(bare)) return { params: bare };
  const short = mapEntries(bare, (key, child) => (key === "description" && typeof child === "string" ? firstSentence(child) : child));
  if (fits(short)) return { params: short, trimmed: "descriptions" };
  const plain = mapEntries(bare, (key, child) => (key === "description" ? undefined : child));
  for (let depth = MAX_OUTLINE_DEPTH; depth > 0; depth--) {
    const o = outline(plain, depth);
    if (fits(o)) return { params: o, trimmed: "outline" };
  }
  return { params: outline(plain, 0), trimmed: "outline" };
}
