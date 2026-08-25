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

export interface Rubric {
  version: string;
  body: string;
}

export interface AppConfig {
  cv: string;
  rubric: Rubric;
  profile: Profile;
  sources: SourcesConfig;
}
