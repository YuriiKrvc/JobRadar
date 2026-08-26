import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './import';

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jobradar-'));
  writeFileSync(join(dir, 'cv.md'), '# Yurii\nSenior Node engineer.\n');
  writeFileSync(join(dir, 'rubric.md'), 'version: 1\n\nScore each dimension 0-100.\n');
  writeFileSync(join(dir, 'profile.yaml'),
    'excludedLocations: ["Onsite: USA"]\nallowedEmploymentTypes: ["full-time"]\nminSalaryUsd: 4000\ntimezone: Europe/Kyiv\n');
  writeFileSync(join(dir, 'sources.yaml'),
    'ats:\n  - { board: greenhouse, slug: acme }\ndjinni:\n  - "https://djinni.co/jobs/keyword-node/"\ndou: []\n');
  return dir;
}

describe('loadConfig', () => {
  it('parses cv, rubric version, and profile', () => {
    const cfg = loadConfig(fixtureDir());
    expect(cfg.cv).toContain('Senior Node engineer');
    expect(cfg.rubric.version).toBe('1');
    expect(cfg.rubric.body).toContain('Score each dimension');
    // The header is a v1 file-format artifact, not rubric prose: it must not
    // reach the dashboard textarea or the LLM prompt.
    expect(cfg.rubric.body).not.toContain('version:');
    expect(cfg.rubric.body).toBe('Score each dimension 0-100.\n');
    expect(cfg.profile.minSalaryUsd).toBe(4000);
    expect(cfg.profile.excludedLocations).toEqual(['Onsite: USA']);
  });

  // A v1 sources.yaml has no selectors, so it cannot produce a usable row: the
  // importer must ignore the file rather than half-import boards that would
  // then fail to fetch anything.
  it('ignores a sources.yaml present on disk', () => {
    const cfg = loadConfig(fixtureDir());
    expect(cfg).not.toHaveProperty('sources');
    expect(Object.keys(cfg).sort()).toEqual(['cv', 'profile', 'rubric']);
  });

  it('throws a named error when a required file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobradar-empty-'));
    expect(() => loadConfig(dir)).toThrow(/cv\.md/);
  });

  it('rejects a rubric with no version header', () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, 'rubric.md'), 'no header here\n');
    expect(() => loadConfig(dir)).toThrow(/version/);
  });
});
