import { NavLink, useLocation } from 'react-router-dom';
import s from './Masthead.module.css';

interface Props {
  runAt: string | null;
  newCount: number;
  scoredCount: number;
  version: number | null;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function Masthead({ runAt, newCount, scoredCount, version }: Props) {
  const onSettings = useLocation().pathname.startsWith('/settings');

  return (
    <header className={s.masthead}>
      <div className={s.top}>
        <div className={s.wordmark}>JobRadar</div>
        <div className={s.tagline}>Stop scrolling job boards. Read the shortlist.</div>

        <div className={s.tabs} role="tablist" aria-label="Sections">
          <NavLink
            to="/" end role="tab" aria-selected={!onSettings}
            className={({ isActive }) => (isActive ? `${s.tab} ${s.tabActive}` : s.tab)}
          >
            Postings
          </NavLink>
          <NavLink
            to="/settings" role="tab" aria-selected={onSettings}
            className={({ isActive }) => (isActive ? `${s.tab} ${s.tabActive}` : s.tab)}
          >
            Settings
          </NavLink>
        </div>
      </div>

      <div className={s.ruleThick} />
      <div className={s.status}>
        <span>{DATE_FMT.format(new Date())}</span>
        <span>
          {runAt ? `Run ${TIME_FMT.format(new Date(runAt))}` : 'No run yet'}
          {' · '}{newCount} new · {scoredCount} scored
        </span>
        <span>{version === null ? 'Settings unread' : `Scoring settings v${version}`}</span>
      </div>
      <div className={s.ruleThin} />
    </header>
  );
}
