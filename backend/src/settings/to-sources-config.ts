import type { sources } from '../db/schema';
import type { SourcesConfig } from './schema';

export type SourceRow = typeof sources.$inferSelect;

/**
 * The table is flat because the dashboard needs rows to toggle; buildSources()
 * wants the grouped shape v1 parsed out of sources.yaml. This is the seam.
 * Disabled rows are dropped here so callers never have to remember to filter.
 */
export function toSourcesConfig(rows: SourceRow[]): SourcesConfig {
  const cfg: SourcesConfig = { ats: [], djinni: [], dou: [] };

  for (const r of rows) {
    if (!r.enabled) continue;

    if (r.kind === 'ats') {
      // The CHECK constraint guarantees both are present for ats rows.
      cfg.ats.push({ board: r.board as 'greenhouse' | 'lever' | 'ashby', slug: r.slug as string });
    } else {
      cfg[r.kind].push(r.url as string);
    }
  }

  return cfg;
}
