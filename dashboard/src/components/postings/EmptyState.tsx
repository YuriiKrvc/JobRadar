import { Link } from 'react-router-dom';
import s from './EmptyState.module.css';

const STEPS = [
  'Fetch each enabled source’s listing page — that is what detects new postings.',
  'Reject anything with a blocked word in its title, before downloading it.',
  'Download each surviving posting’s own page — once, ever.',
  'Drop anything failing your hard filters — with the reason kept on the row.',
  'Score the rest against your CV and rubric; anything over the threshold pings you.',
];

interface Props {
  kind: 'fresh' | 'filtered';
  onClearFilters: () => void;
}

export function EmptyState({ kind, onClearFilters }: Props) {
  if (kind === 'filtered') {
    return (
      <div className={s.filtered}>
        <div className={s.filteredHeadline}>No posting matches these filters.</div>
        <button type="button" className={s.clear} onClick={onClearFilters}>Clear filters</button>
      </div>
    );
  }

  return (
    <div className={s.fresh}>
      <div className={s.headline}>Nothing on the radar yet.</div>
      <p className={s.lede}>
        The worker polls every 30 minutes. Once your CV and at least one source are
        saved, the first shortlist lands within the half hour — and Telegram pings
        you before you think to look.
      </p>

      <div className={s.actions}>
        <Link to="/settings" className={s.action}>Paste your CV</Link>
        <Link to="/settings" className={`${s.action} ${s.actionSecondary}`}>Add a job board</Link>
      </div>

      <div className={s.steps}>
        {STEPS.map((text, i) => (
          <div className={s.step} key={text}>
            <span className={s.stepNumber}>{i + 1}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
