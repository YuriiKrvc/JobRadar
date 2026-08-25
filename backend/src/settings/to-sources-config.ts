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
      // The CHECK constraint only guarantees both columns are NOT NULL for an
      // ats row; it says nothing about which board. The narrow union comes
      // from SourceInputSchema's Zod enum on the single write path
      // (POST /api/sources) and from the importer's SourcesSchema.
      cfg.ats.push({ board: r.board as 'greenhouse' | 'lever' | 'ashby', slug: r.slug as string });
    } else {
      cfg[r.kind].push(r.url as string);
    }
  }

  return cfg;
}
