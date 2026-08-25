import type { Verdict } from '../api/types';

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className="badge">{verdict}</span>;
}
