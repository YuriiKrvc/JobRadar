import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { postings, runLog, scores } from '../db/schema';
import type { HealthRow, PostingFilters, PostingRow } from './api.schema';

@Injectable()
export class DashboardQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async latestScores(f: PostingFilters): Promise<PostingRow[]> {
    const latest = this.db.$with('latest').as(
      this.db.select({
        postingId: scores.postingId,
        maxId: sql<number>`max(${scores.id})`.as('max_id'),
      }).from(scores).groupBy(scores.postingId),
    );

    const conditions: SQL[] = [];
    if (f.verdict) conditions.push(eq(scores.verdict, f.verdict));
    if (f.source) conditions.push(eq(postings.source, f.source));
    if (f.provider) conditions.push(eq(scores.providerId, f.provider));
    if (f.minTotal !== undefined) conditions.push(gte(scores.total, f.minTotal));
    if (f.since) conditions.push(gte(scores.scoredAt, f.since));

    const rows = await this.db.with(latest).select({
      postingId: postings.id,
      title: postings.title,
      company: postings.company,
      url: postings.url,
      source: postings.source,
      location: postings.location,
      total: scores.total,
      verdict: scores.verdict,
      reasoning: scores.reasoning,
      providerId: scores.providerId,
      settingsVersion: scores.settingsVersion,
      scoredAt: scores.scoredAt,
    })
      .from(latest)
      .innerJoin(scores, eq(scores.id, latest.maxId))
      .innerJoin(postings, eq(postings.id, scores.postingId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(scores.total))
      .limit(f.limit);

    return rows.map((r) => ({ ...r, scoredAt: r.scoredAt.toISOString() }));
  }

  async sourceHealth(): Promise<HealthRow[]> {
    const rows = await this.db.select({
      source: runLog.source,
      status: runLog.status,
      ranAt: runLog.ranAt,
      error: runLog.error,
    }).from(runLog).orderBy(desc(runLog.ranAt)).limit(20);

    return rows.map((r) => ({ ...r, ranAt: r.ranAt.toISOString() }));
  }
}
