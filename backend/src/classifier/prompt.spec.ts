import { buildPrompt } from './prompt';
import type { RawPosting } from '../types';
import type { Profile, Rubric } from '../settings/schema';

const profile: Profile = {
  excludedLocations: ['Onsite: USA'],
  allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 4000,
  timezone: 'Europe/Kyiv',
  blockedTitleWords: [],
  blockedDescriptionWords: [],
};
const rubric: Rubric = {
  version: '1',
  body: 'score five dimensions',
  weights: { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 },
};
const posting: RawPosting = {
  id: 'x:1', source: 'x', externalId: '1', url: 'https://e.com/1',
  title: 'Node Engineer', company: 'Acme', location: 'Remote',
  employmentType: 'full-time', description: 'Node and Postgres', raw: {},
};

describe('buildPrompt', () => {
  it('puts the CV, constraints, and rubric in the system message', () => {
    const { system } = buildPrompt({ cv: 'MY CV TEXT', profile, rubric, posting });
    expect(system).toContain('MY CV TEXT');
    expect(system).toContain('Europe/Kyiv');
    expect(system).toContain('Onsite: USA');
    expect(system).toContain('score five dimensions');
  });

  it('puts only the vacancy in the user message', () => {
    const { user } = buildPrompt({ cv: 'MY CV TEXT', profile, rubric, posting });
    expect(user).toContain('Node Engineer');
    expect(user).toContain('Acme');
    expect(user).toContain('Node and Postgres');
    expect(user).not.toContain('MY CV TEXT');
  });

  it('reports unstated location and employment type explicitly', () => {
    const { user } = buildPrompt({
      cv: 'c', profile, rubric,
      posting: { ...posting, location: null, employmentType: null },
    });
    expect(user).toContain('Location: unstated');
    expect(user).toContain('Employment type: unstated');
  });

  it('truncates a very long description so one posting cannot blow the budget', () => {
    const { user } = buildPrompt({
      cv: 'c', profile, rubric,
      posting: { ...posting, description: 'x'.repeat(20_000) },
    });
    expect(user.length).toBeLessThan(14_000);
  });
});
