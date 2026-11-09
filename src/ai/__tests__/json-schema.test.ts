/**
 * Schema dialect tests.
 *
 * Each assertion corresponds to something a provider rejects with a 400 that reads
 * like a model problem rather than a payload problem, which is why they are worth
 * pinning down here rather than discovering on a device.
 */
import { z } from 'zod';

import {
  inlineRefs,
  schemaAsPromptText,
  toAnthropicToolSchema,
  toGeminiResponseSchema,
  toOpenAiStrictSchema,
} from '@/ai/json-schema';
import { RecallEvaluationSchema, WritingFeedbackSchema } from '@/ai/schemas';

type AnyRecord = Record<string, unknown>;

/** Walk every object node in a JSON Schema tree. */
function nodes(schema: unknown): AnyRecord[] {
  if (Array.isArray(schema)) return schema.flatMap(nodes);
  if (typeof schema !== 'object' || schema === null) return [];
  const self = schema as AnyRecord;
  return [self, ...Object.values(self).flatMap(nodes)];
}

function objectNodes(schema: unknown): AnyRecord[] {
  return nodes(schema).filter((node) => node.type === 'object' || node.properties !== undefined);
}

describe('toOpenAiStrictSchema', () => {
  const built = toOpenAiStrictSchema(RecallEvaluationSchema, 'RecallEvaluation');

  it('reports the schema name and strict flag', () => {
    expect(built.name).toBe('RecallEvaluation');
    expect(built.strict).toBe(true);
  });

  it('sets additionalProperties false on every object', () => {
    const objects = objectNodes(built.schema);
    expect(objects.length).toBeGreaterThan(0);
    for (const node of objects) {
      expect(node.additionalProperties).toBe(false);
    }
  });

  it('lists every property in required', () => {
    for (const node of objectNodes(built.schema)) {
      const keys = Object.keys((node.properties ?? {}) as AnyRecord);
      expect(node.required).toEqual(keys);
    }
  });

  it('strips validation keywords strict mode rejects', () => {
    const serialised = JSON.stringify(built.schema);
    for (const keyword of ['minLength', 'maxLength', 'pattern', 'format', '$schema', 'default']) {
      expect(serialised).not.toContain(`"${keyword}"`);
    }
  });

  it('contains no $ref after inlining', () => {
    expect(JSON.stringify(built.schema)).not.toContain('$ref');
  });

  it('makes an optional property nullable rather than omitting it from required', () => {
    const schema = z.object({ always: z.string(), sometimes: z.string().optional() });
    const result = toOpenAiStrictSchema(schema, 'Partial');
    const properties = result.schema.properties as AnyRecord;
    expect(result.schema.required).toEqual(['always', 'sometimes']);
    expect((properties.sometimes as AnyRecord).type).toEqual(['string', 'null']);
    expect((properties.always as AnyRecord).type).toBe('string');
  });

  it('makes an optional enum nullable while keeping its values', () => {
    // Zod drops an optional key from `required` but leaves the subschema a plain
    // type, so this becomes a type array rather than an anyOf.
    const result = toOpenAiStrictSchema(
      z.object({ article: z.enum(['de', 'het']).optional() }),
      'Article'
    );
    const article = (result.schema.properties as AnyRecord).article as AnyRecord;
    expect(result.schema.required).toEqual(['article']);
    expect(article.type).toEqual(['string', 'null']);
    expect(article.enum).toEqual(['de', 'het']);
  });

  it('adds a null branch to an anyOf subschema rather than mangling its type', () => {
    // A nullable array is the anyOf shape; marking it optional too must not drop the
    // branches or set `type: undefined`.
    const result = toOpenAiStrictSchema(
      z.object({ tags: z.array(z.string()).nullable().optional() }),
      'Tags'
    );
    const tags = (result.schema.properties as AnyRecord).tags as AnyRecord;
    const branches = tags.anyOf as AnyRecord[];
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.some((branch) => branch.type === 'null')).toBe(true);
    expect(branches.some((branch) => branch.type === 'array')).toBe(true);
  });

  it('handles a nested array of objects', () => {
    const result = toOpenAiStrictSchema(WritingFeedbackSchema, 'WritingFeedback');
    const corrections = (result.schema.properties as AnyRecord).corrections as AnyRecord;
    const items = corrections.items as AnyRecord;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(Object.keys(items.properties as AnyRecord));
  });
});

describe('toGeminiResponseSchema', () => {
  const schema = toGeminiResponseSchema(RecallEvaluationSchema);

  it('removes additionalProperties, which Gemini rejects', () => {
    expect(JSON.stringify(schema)).not.toContain('additionalProperties');
  });

  it('removes $ref and $defs', () => {
    const serialised = JSON.stringify(schema);
    expect(serialised).not.toContain('$ref');
    expect(serialised).not.toContain('$defs');
  });

  it('emits propertyOrdering, since Gemini ignores JSON key order', () => {
    expect(schema.propertyOrdering).toEqual(Object.keys(schema.properties as AnyRecord));
  });

  it('converts a type array into a nullable single type', () => {
    const nullableSchema = toGeminiResponseSchema(
      z.object({ article: z.enum(['de', 'het']).nullable() })
    );
    const article = (nullableSchema.properties as AnyRecord).article as AnyRecord;
    expect(Array.isArray(article.type)).toBe(false);
    expect(article.nullable).toBe(true);
  });

  it('never leaves a bare type array anywhere in the tree', () => {
    const built = toGeminiResponseSchema(
      z.object({ a: z.string().nullable(), b: z.array(z.number().nullable()) })
    );
    for (const node of nodes(built)) {
      expect(Array.isArray(node.type)).toBe(false);
    }
  });

  it('collapses a nullable array into one branch plus nullable', () => {
    const built = toGeminiResponseSchema(z.object({ tags: z.array(z.string()).nullable() }));
    const tags = (built.properties as AnyRecord).tags as AnyRecord;
    expect(tags.anyOf).toBeUndefined();
    expect(tags.type).toBe('array');
    expect(tags.nullable).toBe(true);
    expect((tags.items as AnyRecord).type).toBe('string');
  });

  it('leaves no anyOf anywhere for our real schemas', () => {
    for (const built of [
      toGeminiResponseSchema(RecallEvaluationSchema),
      toGeminiResponseSchema(WritingFeedbackSchema),
    ]) {
      expect(JSON.stringify(built)).not.toContain('anyOf');
    }
  });

  it('keeps enum values and gives them a string type', () => {
    const quality = (schema.properties as AnyRecord).quality as AnyRecord;
    expect(quality.enum).toEqual(['correct', 'minor_issue', 'wrong']);
    expect(quality.type).toBe('string');
  });
});

describe('toAnthropicToolSchema', () => {
  const tool = toAnthropicToolSchema(RecallEvaluationSchema, 'RecallEvaluation');

  it('prefixes the tool name so forced tool choice can target it', () => {
    expect(tool.name).toBe('emit_RecallEvaluation');
  });

  it('always declares an object input schema', () => {
    expect(tool.input_schema.type).toBe('object');
    expect(tool.input_schema.properties).toBeDefined();
  });

  it('inlines refs', () => {
    expect(JSON.stringify(tool.input_schema)).not.toContain('$ref');
  });

  it('carries a description so the model knows to call it once', () => {
    expect(tool.description).toMatch(/once/i);
  });
});

describe('inlineRefs', () => {
  it('replaces a $ref with its definition', () => {
    const result = inlineRefs({
      type: 'object',
      properties: { child: { $ref: '#/$defs/Child' } },
      $defs: { Child: { type: 'string' } },
    });
    expect(result).toEqual({ type: 'object', properties: { child: { type: 'string' } } });
  });

  it('keeps sibling keys alongside a $ref', () => {
    const result = inlineRefs({
      properties: { child: { $ref: '#/$defs/Child', description: 'kept' } },
      $defs: { Child: { type: 'string' } },
    });
    const child = (result.properties as AnyRecord).child as AnyRecord;
    expect(child).toEqual({ type: 'string', description: 'kept' });
  });

  it('throws on a recursive ref instead of looping forever', () => {
    expect(() =>
      inlineRefs({
        $ref: '#/$defs/Node',
        $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
      })
    ).toThrow(/Recursive/);
  });
});

describe('schemaAsPromptText', () => {
  it('names the schema and forbids prose', () => {
    const text = schemaAsPromptText(RecallEvaluationSchema, 'RecallEvaluation');
    expect(text).toContain('RecallEvaluation');
    expect(text).toMatch(/nothing else/i);
    expect(text).toContain('"properties"');
  });
});
