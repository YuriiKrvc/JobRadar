import { z } from 'zod';

export const VerdictSchema = z.enum(['STRONG', 'MAYBE', 'NO']);

export const PostingRowSchema = z.object({
  postingId: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  source: z.string(),
  location: z.string().nullable(),
  total: z.number().int(),
  verdict: VerdictSchema,
  reasoning: z.string(),
  providerId: z.string(),
  settingsVersion: z.string(),
  scoredAt: z.string(),
});
export type PostingRow = z.infer<typeof PostingRowSchema>;

export const HealthRowSchema = z.object({
  source: z.string(),
  status: z.string(),
  ranAt: z.string(),
  error: z.string().nullable(),
});
export type HealthRow = z.infer<typeof HealthRowSchema>;

export const PostingFiltersSchema = z.object({
  verdict: VerdictSchema.optional(),
  source: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  minTotal: z.coerce.number().int().min(0).max(100).optional(),
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type PostingFilters = z.infer<typeof PostingFiltersSchema>;
