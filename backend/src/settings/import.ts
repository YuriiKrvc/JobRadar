import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ProfileSchema, SourcesSchema, type FileConfig } from './schema';

function read(dir: string, name: string): string {
  const path = join(dir, name);
  if (!existsSync(path)) {
    throw new Error(`Missing required config file: ${name} (looked in ${dir})`);
  }
  return readFileSync(path, 'utf8');
}

// The header line is still required: it is how a genuine v1 rubric.md is
// identified, and importing a file that lacks it is more likely a
// misconfiguration than an intentional upgrade, so it should fail loudly.
// Its VALUE, though, is now dead — app_settings.version replaced it — and the
// line must not survive into the body, which becomes the rubric prose shown in
// the dashboard textarea and fed to the model verbatim.
const VERSION_HEADER = /^version:[ \t]*(\S+)[ \t]*\r?\n?/m;

function parseRubric(text: string): FileConfig['rubric'] {
  const match = VERSION_HEADER.exec(text);
  if (!match?.[1]) {
    throw new Error('rubric.md must start with a "version: <id>" header line');
  }
  return { version: match[1], body: text.replace(VERSION_HEADER, '').trimStart() };
}

export function loadConfig(dir: string): FileConfig {
  return {
    cv: read(dir, 'cv.md'),
    rubric: parseRubric(read(dir, 'rubric.md')),
    profile: ProfileSchema.parse(parseYaml(read(dir, 'profile.yaml'))),
    sources: SourcesSchema.parse(parseYaml(read(dir, 'sources.yaml'))),
  };
}
