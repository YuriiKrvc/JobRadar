import type { SourcesConfig } from '../settings/schema';
import type { JobSource } from '../types';
import { createAtsSource } from './ats';
import { createDjinniSource } from './djinni';
import { createDouSource } from './dou';

export function buildSources(cfg: SourcesConfig): JobSource[] {
  return [
    ...cfg.ats.map((e) => createAtsSource(e)),
    ...cfg.djinni.map((url) => createDjinniSource(url)),
    ...cfg.dou.map((url) => createDouSource(url)),
  ];
}
