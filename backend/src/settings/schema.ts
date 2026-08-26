import { z } from 'zod';

// One definition of each field's validation, reused by both profile schemas
// below so the lenient and the strict shape can never drift apart.
const profileFields = {
  excludedLocations: z.array(z.string()),
  allowedEmploymentTypes: z.array(z.string()),
  minSalaryUsd: z.number().int().positive().nullable(),
  timezone: z.string(),
  blockedTitleWords: z.array(z.string()),
  blockedDescriptionWords: z.array(z.string()),
};

/**
 * Lenient on purpose: the file importer parses a v1 `profile.yaml` that may
 * legitimately omit keys, and relies on these defaults to fill them in. Never
 * use this at an HTTP boundary — see ProfileBodySchema.
 */
export const ProfileSchema = z.object({
  excludedLocations: profileFields.excludedLocations.default([]),
  allowedEmploymentTypes: profileFields.allowedEmploymentTypes.default([]),
  minSalaryUsd: profileFields.minSalaryUsd.default(null),
  timezone: profileFields.timezone.default('Europe/Kyiv'),
  blockedTitleWords: profileFields.blockedTitleWords.default([]),
  blockedDescriptionWords: profileFields.blockedDescriptionWords.default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * The wire shape for PUT /api/settings/profile. Every field is required and
 * unknown keys are rejected, matching the cv and rubric endpoints: the PUT
 * replaces the whole profile document, so a body missing a field would reset
 * that field, bump the settings version, and invalidate every prior score.
 * Defaults belong to the importer, not to a user-facing write.
 */
export const ProfileBodySchema = z.object(profileFields).strict();

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
