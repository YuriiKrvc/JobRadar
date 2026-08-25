import { z } from 'zod';

export const ProfileSchema = z.object({
  excludedLocations: z.array(z.string()).default([]),
  allowedEmploymentTypes: z.array(z.string()).default([]),
  minSalaryUsd: z.number().int().positive().nullable().default(null),
  timezone: z.string().default('Europe/Kyiv'),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const SourcesSchema = z.object({
  ats: z.array(z.object({
    board: z.enum(['greenhouse', 'lever', 'ashby']),
    slug: z.string(),
  })).default([]),
  djinni: z.array(z.string().url()).default([]),
  dou: z.array(z.string().url()).default([]),
});
export type SourcesConfig = z.infer<typeof SourcesSchema>;

export const RubricWeightsSchema = z
  .object({
    coreStack: z.number().int().min(0).max(1000),
    seniority: z.number().int().min(0).max(1000),
    domain: z.number().int().min(0).max(1000),
    logistics: z.number().int().min(0).max(1000),
    growth: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine((w) => Object.values(w).some((n) => n > 0), {
    message: 'at least one weight must be above zero',
  });
export type RubricWeights = z.infer<typeof RubricWeightsSchema>;

export const CvBodySchema = z.object({ cv: z.string() }).strict();

export const RubricBodySchema = z.object({
  body: z.string(),
  weights: RubricWeightsSchema,
}).strict();

export const SourceInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ats'),
    board: z.enum(['greenhouse', 'lever', 'ashby']),
    slug: z.string().min(1),
  }).strict(),
  z.object({ kind: z.literal('djinni'), url: z.string().url() }).strict(),
  z.object({ kind: z.literal('dou'), url: z.string().url() }).strict(),
]);
export type SourceInput = z.infer<typeof SourceInputSchema>;

export const EnabledBodySchema = z.object({ enabled: z.boolean() }).strict();

/** The runtime snapshot. `version` is String(app_settings.version). */
export interface Rubric {
  version: string;
  body: string;
  weights: RubricWeights;
}

export interface AppSettings {
  cv: string;
  rubric: Rubric;
  profile: Profile;
  sources: SourcesConfig;
}

/**
 * What the one-shot importer reads off disk. Weights were never in rubric.md,
 * so a file import supplies DEFAULT_WEIGHTS separately.
 */
export interface FileConfig {
  cv: string;
  rubric: { version: string; body: string };
  profile: Profile;
  sources: SourcesConfig;
}
