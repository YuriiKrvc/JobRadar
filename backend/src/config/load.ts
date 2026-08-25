import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ProfileSchema, SourcesSchema, type AppConfig, type Rubric } from './schema';

function read(dir: string, name: string): string {
  const path = join(dir, name);
  if (!existsSync(path)) {
    throw new Error(`Missing required config file: ${name} (looked in ${dir})`);
  }
  return readFileSync(path, 'utf8');
}

function parseRubric(text: string): Rubric {
  const match = /^version:\s*(\S+)\s*$/m.exec(text);
  if (!match?.[1]) {
    throw new Error('rubric.md must start with a "version: <id>" header line');
  }
  return { version: match[1], body: text };
}

export function loadConfig(dir: string): AppConfig {
  return {
    cv: read(dir, 'cv.md'),
    rubric: parseRubric(read(dir, 'rubric.md')),
    profile: ProfileSchema.parse(parseYaml(read(dir, 'profile.yaml'))),
    sources: SourcesSchema.parse(parseYaml(read(dir, 'sources.yaml'))),
  };
}
