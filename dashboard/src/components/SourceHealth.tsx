import { Link } from 'react-router-dom';
import type { HealthRow } from '../api/types';
import s from './SourceHealth.module.css';

export interface SourceRuns {
  source: string;
  status: string;
  error: string | null;
  /** Newest first, at most ten. */
  runs: HealthRow[];
}

/**
 * `sourceHealth()` returns the newest rows across every source in one list,
 * ordered newest-first, so first-seen is newest-per-source.
 */
export function groupRuns(rows: HealthRow[]): SourceRuns[] {
  const bySource = new Map<string, HealthRow[]>();
  for (const row of rows) {
    const runs = bySource.get(row.source);
    if (runs) runs.push(row);
    else bySource.set(row.source, [row]);
  }

  return [...bySource.entries()].map(([source, runs]) => ({
    source,
    status: runs[0]!.status,
    error: runs[0]!.error,
    runs: runs.slice(0, 10),
  }));
}

function tickClass(status: string): string {
  if (status === 'error') return `${s.tick} ${s.tickError}`;
  // Anything that is neither ok nor error — a timeout, a future status — reads
  // as neutral grey rather than silently as a success.
  if (status === 'ok') return `${s.tick}`;
  return `${s.tick} ${s.tickOther}`;
}

/**
 * `settings` is not a board. The pipeline logs its "settings incomplete" guard
 * under that pseudo-source, and SetupBanner already speaks for it — leaving it
 * here would list it as a failing job board and raise a second, duplicate
 * alert for the same condition.
 */
const PSEUDO_SOURCES = new Set(['settings']);

export function SourceHealth({ rows }: { rows: HealthRow[] }) {
  const boards = rows.filter((r) => !PSEUDO_SOURCES.has(r.source));
  if (boards.length === 0) return null;

  const groups = groupRuns(boards);
  const failing = groups.filter((g) => g.status === 'error');

  return (
    <div className={s.section}>
      <div className={s.head}>
        <div className={s.title}>Source health</div>
        <div className={s.sub}>last 10 runs · newest left</div>

        {failing.length > 0 && (
          <div className={s.alert} role="alert">
            ▲ {failing.length} {failing.length === 1 ? 'source' : 'sources'} failing —
            your shortlist may be incomplete
          </div>
        )}
      </div>

      <div className={s.panels}>
        {groups.map((g) => {
          const broken = g.status === 'error';
          const spoken = `Last ${g.runs.length} runs of ${g.source}: `
            + g.runs.map((r) => r.status).join(', ');

          return (
            <div className={broken ? `${s.panel} ${s.panelBroken}` : s.panel} key={g.source}>
              <div className={s.panelHead}>
                <span>{g.source}</span>
                <span className={broken ? `${s.status} ${s.statusBroken}` : s.status}>
                  {g.status}
                </span>
              </div>

              <div className={s.strip} role="img" aria-label={spoken}>
                {g.runs.map((r, i) => (
                  <span key={`${r.ranAt}-${i}`} className={tickClass(r.status)} />
                ))}
              </div>

              <div className={broken ? `${s.note} ${s.noteBroken}` : s.note}>
                {g.error ?? `Last run ${new Date(g.runs[0]!.ranAt).toLocaleString()}`}
              </div>

              {/* Points at Settings rather than a per-source form: the
                  custom-sources feature that would give each source its own
                  anchor is specced but not built. */}
              {broken && (
                <Link to="/settings" className={s.repair}>
                  Repair this source&rsquo;s selectors
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
