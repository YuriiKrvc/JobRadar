import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './load';

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
  it('parses cv, rubric version, profile, and sources', () => {
    const cfg = loadConfig(fixtureDir());
    expect(cfg.cv).toContain('Senior Node engineer');
    expect(cfg.rubric.version).toBe('1');
    expect(cfg.rubric.body).toContain('Score each dimension');
    expect(cfg.profile.minSalaryUsd).toBe(4000);
    expect(cfg.profile.excludedLocations).toEqual(['Onsite: USA']);
    expect(cfg.sources.ats[0]).toEqual({ board: 'greenhouse', slug: 'acme' });
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
