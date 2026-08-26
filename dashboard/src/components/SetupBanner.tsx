import { Link } from 'react-router-dom';
import s from './SetupBanner.module.css';

export function SetupBanner({ message }: { message: string }) {
  return (
    <div className={s.banner} role="alert">
      <div className={s.label}>SET UP</div>
      <div className={s.body}>
        <div className={s.headline}>The last run could not score anything.</div>
        <p className={s.reason}>
          {message}. Until that is fixed the radar polls nothing and this list stays empty.
        </p>
      </div>
      <Link to="/settings" className={s.action}>Finish setup →</Link>
    </div>
  );
}
