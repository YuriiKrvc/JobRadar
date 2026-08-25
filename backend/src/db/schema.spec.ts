import { postings, scores, notifications, runLog } from './schema';
import { getTableName } from 'drizzle-orm';

describe('schema', () => {
  it('defines the four expected tables', () => {
    expect(getTableName(postings)).toBe('postings');
    expect(getTableName(scores)).toBe('scores');
    expect(getTableName(notifications)).toBe('notifications');
    expect(getTableName(runLog)).toBe('run_log');
  });
});
