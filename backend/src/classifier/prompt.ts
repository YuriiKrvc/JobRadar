import type { RawPosting } from '../types';
import type { Profile, Rubric } from '../settings/schema';

export interface PromptArgs {
  cv: string;
  profile: Profile;
  // Only `body` is rendered into the prompt, so accept anything with that
  // shape — the file-backed AppConfigService has no weights to offer yet.
  rubric: Pick<Rubric, 'body'>;
  posting: RawPosting;
}

export function buildPrompt(args: PromptArgs): { system: string; user: string } {
  const { cv, profile, rubric, posting } = args;

  const system = [
    'You score job vacancies against one candidate. Be strict and concrete.',
    'Judge only from the CV and the vacancy text. Never invent experience.',
    '',
    '## Candidate CV',
    cv.trim(),
    '',
    '## Candidate constraints',
    `- Timezone: ${profile.timezone}`,
    `- Acceptable employment types: ${profile.allowedEmploymentTypes.join(', ') || 'any'}`,
    `- Excluded locations: ${profile.excludedLocations.join(', ') || 'none'}`,
    `- Minimum monthly salary (USD): ${profile.minSalaryUsd ?? 'unspecified'}`,
    '',
    '## Rubric',
    rubric.body.trim(),
    '',
    'Respond with a single JSON object matching the required schema. No prose outside it.',
  ].join('\n');

  const user = [
    '## Vacancy',
    `Title: ${posting.title}`,
    `Company: ${posting.company}`,
    `Location: ${posting.location ?? 'unstated'}`,
    `Employment type: ${posting.employmentType ?? 'unstated'}`,
    `URL: ${posting.url}`,
    '',
    posting.description.slice(0, 12000),
  ].join('\n');

  return { system, user };
}
