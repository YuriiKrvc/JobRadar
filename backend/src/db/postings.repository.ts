import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { DB } from './db.module';
import type { Database } from './client';
import { notifications, postings, runLog, scores } from './schema';
import type { FitVerdict, RawPosting, Verdict } from '../types';

export interface PendingNotification {
  scoreId: number;
  postingId: string;
  title: string;
  company: string;
  url: string;
  location: string | null;
  total: number;
  verdict: Verdict;
  reasoning: string;
}

@Injectable()
export class PostingsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async upsert(p: RawPosting): Promise<{ isNew: boolean }> {
    const rows = await this.db
      .insert(postings)
      .values({
        id: p.id, source: p.source, url: p.url, title: p.title, company: p.company,
        location: p.location, employmentType: p.employmentType,
        description: p.description, raw: p.raw as object,
      })
      .onConflictDoUpdate({ target: postings.id, set: { lastSeen: new Date() } })
      .returning({ firstSeen: postings.firstSeen, lastSeen: postings.lastSeen });

    const row = rows[0];
    if (!row) throw new Error(`upsert returned no row for ${p.id}`);
    return { isNew: row.firstSeen.getTime() === row.lastSeen.getTime() };
  }

  /**
   * The real dedupe key. A posting whose classification threw has no score, so
   * the next run retries it; a scored or hard-filtered posting is never paid
   * for twice.
   */
  async hasScore(postingId: string): Promise<boolean> {
    const rows = await this.db.select({ id: scores.id })
      .from(scores).where(eq(scores.postingId, postingId)).limit(1);
    return rows.length > 0;
  }

  async insertScore(postingId: string, v: FitVerdict): Promise<number> {
    const rows = await this.db.insert(scores).values({
      postingId,
      providerId: v.providerId,
      rubricVersion: v.rubricVersion,
      total: v.total,
      verdict: v.verdict,
      subscores: v.subscores,
      reasoning: v.reasoning,
    }).returning({ id: scores.id });

    const row = rows[0];
    if (!row) throw new Error(`insertScore returned no row for ${postingId}`);
    return row.id;
  }

  async pendingNotifications(minTotal: number, channel: string): Promise<PendingNotification[]> {
    // LEFT JOIN … IS NULL rather than `NOT IN (subquery)`: Drizzle does not
    // parenthesise an interpolated subquery reliably inside sql``.
    const sentOk = this.db.$with('sent_ok').as(
      this.db.select({ scoreId: notifications.scoreId })
        .from(notifications)
        .where(and(eq(notifications.channel, channel), isNotNull(notifications.sentAt))),
    );

    return this.db.with(sentOk).select({
      scoreId: scores.id,
      postingId: postings.id,
      title: postings.title,
      company: postings.company,
      url: postings.url,
      location: postings.location,
      total: scores.total,
      verdict: scores.verdict,
      reasoning: scores.reasoning,
    })
      .from(scores)
      .innerJoin(postings, eq(postings.id, scores.postingId))
      .leftJoin(sentOk, eq(sentOk.scoreId, scores.id))
      .where(and(gte(scores.total, minTotal), isNull(sentOk.scoreId)))
      .orderBy(desc(scores.total));
  }

  async recordNotification(scoreId: number, channel: string, error?: string): Promise<void> {
    await this.db.insert(notifications).values({
      scoreId, channel, sentAt: error ? null : new Date(), error: error ?? null,
    });
  }

  async logRun(source: string, status: 'ok' | 'error', postingsSeen: number, error?: string): Promise<void> {
    await this.db.insert(runLog).values({ source, status, postingsSeen, error: error ?? null });
  }
}
