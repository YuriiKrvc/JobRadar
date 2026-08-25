import { applyHardFilters } from './filters';
import type { RawPosting } from './types';
import type { Profile } from './settings/schema';

const profile: Profile = {
  excludedLocations: ['onsite: usa'],
  allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 4000,
  timezone: 'Europe/Kyiv',
};

function posting(over: Partial<RawPosting> = {}): RawPosting {
  return {
    id: 'x:1', source: 'x', externalId: '1', url: 'https://e.com/1',
    title: 'Node Engineer', company: 'Acme', location: 'Remote - Europe',
    employmentType: 'full-time', description: 'Salary $6000/mo', raw: {}, ...over,
  };
}

describe('applyHardFilters', () => {
  it('passes a posting that satisfies every constraint', () => {
    expect(applyHardFilters(posting(), profile)).toEqual({ passed: true });
  });

  it('rejects an excluded location, case-insensitively', () => {
    expect(applyHardFilters(posting({ location: 'Onsite: USA' }), profile))
      .toEqual({ passed: false, rule: 'location' });
  });

  it('rejects a disallowed employment type', () => {
    expect(applyHardFilters(posting({ employmentType: 'internship' }), profile))
      .toEqual({ passed: false, rule: 'employment-type' });
  });

  it('rejects a stated salary below the floor', () => {
    expect(applyHardFilters(posting({ description: 'We offer $2500 per month' }), profile))
      .toEqual({ passed: false, rule: 'salary' });
  });

  it('passes when no salary is stated at all', () => {
    expect(applyHardFilters(posting({ description: 'Great team, no numbers here' }), profile))
      .toEqual({ passed: true });
  });

  it('passes an unknown employment type when the profile lists none', () => {
    const open: Profile = { ...profile, allowedEmploymentTypes: [] };
    expect(applyHardFilters(posting({ employmentType: 'internship' }), open))
      .toEqual({ passed: true });
  });
});
