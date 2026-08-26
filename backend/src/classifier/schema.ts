import { z } from 'zod';

const DimensionSchema = z.object({
  score: z.number().int().min(0).max(100),
  note: z.string().min(1),
});

export const RawVerdictSchema = z.object({
  subscores: z.object({
    coreStack: DimensionSchema,
    seniority: DimensionSchema,
    domain: DimensionSchema,
    logistics: DimensionSchema,
    growth: DimensionSchema,
  }),
  summary: z.string().min(1),
});

export type RawVerdict = z.infer<typeof RawVerdictSchema>;

const dim = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    note: { type: 'string', minLength: 1 },
  },
  required: ['score', 'note'],
  additionalProperties: false,
} as const;

export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subscores: {
      type: 'object',
      properties: {
        coreStack: dim, seniority: dim, domain: dim, logistics: dim, growth: dim,
      },
      required: ['coreStack', 'seniority', 'domain', 'logistics', 'growth'],
      additionalProperties: false,
    },
    summary: { type: 'string', minLength: 1 },
  },
  required: ['subscores', 'summary'],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;
