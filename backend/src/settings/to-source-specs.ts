import type { sources } from '../db/schema';
import type { SourceSpec } from './schema';

export type SourceRow = typeof sources.$inferSelect;

/**
 * The table is flat because the dashboard needs rows to toggle; the pipeline
 * wants only the enabled ones. This is the seam, and dropping the disabled rows
 * here means no caller has to remember to filter.
 */
export function toSourceSpecs(rows: SourceRow[]): SourceSpec[] {
  return rows
    .filter((r) => r.enabled)
    .map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      selectors: r.selectors,
      blockedTitleWords: r.blockedTitleWords,
      blockedDescriptionWords: r.blockedDescriptionWords,
    }));
}
