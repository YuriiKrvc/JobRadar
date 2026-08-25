import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const sql = postgres(url, { max: 5 });
  return drizzle(sql, { schema });
}

/**
 * Closes the underlying postgres.js pool. Without this the process keeps an
 * open connection and never exits, so `once.js` hangs instead of terminating.
 */
export async function closeDb(db: Database): Promise<void> {
  await db.$client.end();
}
