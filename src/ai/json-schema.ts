/**
 * One Zod schema per output type; every provider dialect is derived from it here.
 *
 * All three transforms start from Zod v4's own `z.toJSONSchema` and then fix it up,
 * because each provider rejects a different subset of JSON Schema:
 *
 *  - OpenAI strict mode demands `additionalProperties: false` on every object and
 *    every property listed in `required`, and rejects `$ref` and most validation
 *    keywords.
 *  - Anthropic's `input_schema` is close to vanilla, but inlining `$defs` removes a
 *    variable.
 *  - Gemini's `responseSchema` is an OpenAPI 3.0 subset: no `$ref`, no
 *    `additionalProperties`, no type arrays, and it ignores JSON key order unless
 *    told otherwise.
 *
 * Note that stripping a validation keyword only removes it from the wire format. The
 * Zod schema still enforces it when we parse the response, which is the check that
 * actually matters.
 */
import { z, type ZodType } from 'zod';

export type JsonSchema = Record<string, unknown>;

/** Keywords neither OpenAI strict mode nor Gemini accept. */
const UNSUPPORTED_KEYWORDS = [
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'default',
  'examples',
  'const',
  '$schema',
  '$id',
  'not',
  'allOf',
  'oneOf',
  'if',
  'then',
  'else',
  'patternProperties',
  'dependentSchemas',
  'unevaluatedProperties',
] as const;

function isPlainObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The raw JSON Schema for a Zod type, as the response shape (`io: 'output'`). */
export function baseJsonSchema(schema: ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as JsonSchema;
}

/**
 * Replace every `$ref` with the definition it points at. Our schemas are flat by
 * design, so a cycle is a bug in the schema rather than something to support.
 */
export function inlineRefs(root: JsonSchema): JsonSchema {
  const defs = (isPlainObject(root.$defs) ? root.$defs : {}) as Record<string, unknown>;
  const definitions = (
    isPlainObject(root.definitions) ? root.definitions : {}
  ) as Record<string, unknown>;

  function resolve(pointer: string, seen: ReadonlySet<string>): JsonSchema {
    const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(pointer);
    if (!match?.[1]) throw new Error(`Unsupported $ref: ${pointer}`);
    const key = match[1];
    if (seen.has(key)) {
      throw new Error(`Recursive $ref "${key}" -- keep AI output schemas flat.`);
    }
    const target = defs[key] ?? definitions[key];
    if (!isPlainObject(target)) throw new Error(`Unresolvable $ref: ${pointer}`);
    return walk(target, new Set([...seen, key])) as JsonSchema;
  }

  function walk(node: unknown, seen: ReadonlySet<string>): unknown {
    if (Array.isArray(node)) return node.map((item) => walk(item, seen));
    if (!isPlainObject(node)) return node;

    if (typeof node.$ref === 'string') {
      const resolved = resolve(node.$ref, seen);
      // Sibling keys alongside $ref (usually `description`) should survive.
      const siblings = Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== '$ref')
      );
      return { ...resolved, ...walk(siblings, seen) as JsonSchema };
    }

    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$defs' || key === 'definitions') continue;
      out[key] = walk(value, seen);
    }
    return out;
  }

  return walk(root, new Set()) as JsonSchema;
}

function stripKeywords(node: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** True for the `{ "type": "null" }` branch Zod emits inside `anyOf`. */
function isNullBranch(node: unknown): boolean {
  return isPlainObject(node) && node.type === 'null';
}

/**
 * Make a subschema accept null.
 *
 * Zod expresses nullability two different ways depending on the inner type: a scalar
 * becomes `type: ["string", "null"]`, while an enum or array becomes
 * `anyOf: [ <branch>, { type: "null" } ]`. Both shapes have to be handled or
 * nullable enums silently lose their null branch.
 */
function makeNullable(node: JsonSchema): JsonSchema {
  if (Array.isArray(node.anyOf)) {
    return node.anyOf.some(isNullBranch)
      ? node
      : { ...node, anyOf: [...node.anyOf, { type: 'null' }] };
  }
  if (typeof node.type === 'string') {
    return node.type === 'null' ? node : { ...node, type: [node.type, 'null'] };
  }
  if (Array.isArray(node.type)) {
    return node.type.includes('null') ? node : { ...node, type: [...node.type, 'null'] };
  }
  // No type and no anyOf: wrap it so the null branch is still expressible.
  return { anyOf: [node, { type: 'null' }] };
}

/**
 * OpenAI strict mode. Returns the `json_schema` payload for `response_format`.
 *
 * Every property is promoted into `required`; the ones Zod marked optional become
 * nullable instead, which is the only way to express "may be absent" under strict.
 */
export function toOpenAiStrictSchema(
  schema: ZodType,
  name: string
): { name: string; strict: true; schema: JsonSchema } {
  function transform(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(transform);
    if (!isPlainObject(node)) return node;

    let out = stripKeywords(node);

    if (out.type === 'object' || isPlainObject(out.properties)) {
      const properties = isPlainObject(out.properties) ? out.properties : {};
      const originallyRequired = new Set(
        Array.isArray(out.required) ? out.required.filter((k): k is string => typeof k === 'string') : []
      );

      const nextProperties: JsonSchema = {};
      for (const [key, value] of Object.entries(properties)) {
        const child = transform(value);
        // Strict mode requires every key in `required`, so a key Zod marked optional
        // has to become nullable instead of absent.
        nextProperties[key] =
          isPlainObject(child) && !originallyRequired.has(key) ? makeNullable(child) : child;
      }

      out = {
        ...out,
        type: 'object',
        properties: nextProperties,
        // Strict mode: all keys required, no extras.
        required: Object.keys(nextProperties),
        additionalProperties: false,
      };
    }

    if (out.items !== undefined) out = { ...out, items: transform(out.items) };
    if (Array.isArray(out.anyOf)) out = { ...out, anyOf: out.anyOf.map(transform) };

    return out;
  }

  return {
    name,
    strict: true,
    schema: transform(inlineRefs(baseJsonSchema(schema))) as JsonSchema,
  };
}

/**
 * Anthropic's forced-tool payload. Tool use is Anthropic's structured-output
 * mechanism and is the most reliable of the four, so this is the default rung for it.
 */
export function toAnthropicToolSchema(
  schema: ZodType,
  name: string,
  description?: string
): { name: string; description: string; input_schema: JsonSchema } {
  const inlined = inlineRefs(baseJsonSchema(schema));
  return {
    name: `emit_${name}`,
    description:
      description ?? `Return the ${name} result. Call this tool exactly once.`,
    input_schema: { ...inlined, type: 'object' },
  };
}

/**
 * Gemini's `responseSchema`. Five transforms, each for something Gemini rejects or
 * ignores: inline refs, drop `additionalProperties`, turn type arrays into
 * `nullable`, strip unsupported keywords, and emit `propertyOrdering`.
 *
 * `propertyOrdering` is not cosmetic -- Gemini does not preserve JSON key order, and
 * field order measurably affects quality when a later field should be reasoned about
 * after an earlier one (an `explanation` that follows its `status`).
 */
export function toGeminiResponseSchema(schema: ZodType): JsonSchema {
  function transform(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(transform);
    if (!isPlainObject(node)) return node;

    let out = stripKeywords(node);
    delete out.additionalProperties;

    // Gemini has no type arrays; it has a `nullable` flag.
    if (Array.isArray(out.type)) {
      const types = out.type.filter((t): t is string => typeof t === 'string');
      const nonNull = types.filter((t) => t !== 'null');
      out.type = nonNull[0] ?? 'string';
      if (types.length !== nonNull.length) out.nullable = true;
    }

    // Zod expresses a nullable enum or array as `anyOf: [branch, {type:'null'}]`.
    // Gemini's anyOf support is limited, so collapse the common single-branch case
    // into that branch plus `nullable`, which it handles reliably.
    if (Array.isArray(out.anyOf)) {
      const branches = out.anyOf;
      const hadNull = branches.some(isNullBranch);
      const real = branches.filter((branch) => !isNullBranch(branch));
      if (real.length === 1 && isPlainObject(real[0])) {
        const collapsed = transform(real[0]) as JsonSchema;
        const { anyOf: _discarded, ...rest } = out;
        out = { ...collapsed, ...rest };
        if (hadNull) out.nullable = true;
        return out;
      }
      out.anyOf = real.map(transform);
      if (hadNull) out.nullable = true;
    }

    if (isPlainObject(out.properties)) {
      const nextProperties: JsonSchema = {};
      for (const [key, value] of Object.entries(out.properties)) {
        nextProperties[key] = transform(value);
      }
      out.properties = nextProperties;
      out.type = 'object';
      out.propertyOrdering = Object.keys(nextProperties);
    }

    if (out.items !== undefined) out.items = transform(out.items);

    // Gemini supports enum only on string-typed fields.
    if (Array.isArray(out.enum) && out.type === undefined) out.type = 'string';

    return out;
  }

  return transform(inlineRefs(baseJsonSchema(schema))) as JsonSchema;
}

/**
 * The prompt-only rung: the schema as text, for models with no structured-output
 * support at all. Pretty-printed because models follow an indented schema better
 * than a minified one.
 */
export function schemaAsPromptText(schema: ZodType, name: string): string {
  const inlined = inlineRefs(baseJsonSchema(schema));
  return [
    `Respond with a single JSON object matching this JSON Schema named ${name}.`,
    'Output the object and nothing else: no prose, no explanation, no code fences.',
    '',
    JSON.stringify(inlined, null, 2),
  ].join('\n');
}
