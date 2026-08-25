import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { appSettings, sources } from '../db/schema';
import type { Profile, RubricWeights, SourceInput } from './schema';
import type { SourceRow } from './to-sources-config';

export type AppSettingsRow = typeof appSettings.$inferSelect;

/**
 * drizzle-orm 0.44 wraps every driver error in a DrizzleQueryError, which
 * hides the Postgres error `code` (e.g. 23505 unique_violation, 23514
 * check_violation) on `.cause` instead of on the thrown error itself.
 * Unwrap rather than rewrap so the original error, code intact, is what
 * propagates to callers — never swallow, and only unwrap when there is an
 * Error cause to unwrap to.
 */
function unwrapDriverError(err: unknown): unknown {
  if (err instanceof Error && err.cause instanceof Error) return err.cause;
  return err;
}

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async readRow(): Promise<AppSettingsRow> {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row) {
      throw new Error(
        'Settings are not initialised: app_settings has no row. ' +
        'Run the seeder (docker compose run --rm migrate) before starting the worker.',
      );
    }
    return row;
  }

  async listSources(): Promise<SourceRow[]> {
    return this.db.select().from(sources).orderBy(sources.createdAt);
  }

  private async bump(patch: Partial<AppSettingsRow>): Promise<void> {
    try {
      await this.db
        .update(appSettings)
        .set({ ...patch, version: sql`${appSettings.version} + 1`, updatedAt: new Date() })
        .where(eq(appSettings.id, true));
    } catch (err) {
      throw unwrapDriverError(err);
    }
  }

  updateCv(cv: string): Promise<void> {
    return this.bump({ cv });
  }

  updateRubric(rubricBody: string, rubricWeights: RubricWeights): Promise<void> {
    return this.bump({ rubricBody, rubricWeights });
  }

  updateProfile(profile: Profile): Promise<void> {
    return this.bump({ profile });
  }

  async addSource(input: SourceInput): Promise<SourceRow> {
    const values = input.kind === 'ats'
      ? { kind: 'ats' as const, board: input.board, slug: input.slug }
      : { kind: input.kind, url: input.url };

    try {
      const [row] = await this.db.insert(sources).values(values).returning();
      return row!;
    } catch (err) {
      throw unwrapDriverError(err);
    }
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<SourceRow | null> {
    const [row] = await this.db
      .update(sources).set({ enabled }).where(eq(sources.id, id)).returning();
    return row ?? null;
  }

  async deleteSource(id: string): Promise<boolean> {
    const rows = await this.db.delete(sources).where(eq(sources.id, id)).returning();
    return rows.length > 0;
  }
}
