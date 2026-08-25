import {
  pgTable, pgEnum, text, integer, timestamp, jsonb, serial, index,
  boolean, uuid, unique, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SubScores } from '../types';
import type { Profile, RubricWeights } from '../settings/schema';

export const verdictEnum = pgEnum('verdict', ['STRONG', 'MAYBE', 'NO']);
export const runStatusEnum = pgEnum('run_status', ['ok', 'error']);

export const postings = pgTable('postings', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  employmentType: text('employment_type'),
  description: text('description').notNull(),
  raw: jsonb('raw').notNull(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});

export const scores = pgTable('scores', {
  id: serial('id').primaryKey(),
  postingId: text('posting_id').notNull().references(() => postings.id),
  providerId: text('provider_id').notNull(),
  settingsVersion: text('settings_version').notNull(),
  total: integer('total').notNull(),
  verdict: verdictEnum('verdict').notNull(),
  subscores: jsonb('subscores').$type<SubScores>().notNull(),
  reasoning: text('reasoning').notNull(),
  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('scores_posting_idx').on(t.postingId),
  index('scores_total_idx').on(t.total),
]);

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  scoreId: integer('score_id').notNull().references(() => scores.id),
  channel: text('channel').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  error: text('error'),
});

export const runLog = pgTable('run_log', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(),
  status: runStatusEnum('status').notNull(),
  postingsSeen: integer('postings_seen').notNull().default(0),
  error: text('error'),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sourceKindEnum = pgEnum('source_kind', ['ats', 'djinni', 'dou']);

export const appSettings = pgTable('app_settings', {
  // A boolean primary key fixed at true is how a single-row table is spelled:
  // any second insert collides on the key.
  id: boolean('id').primaryKey().default(true),
  cv: text('cv').notNull(),
  rubricBody: text('rubric_body').notNull(),
  rubricWeights: jsonb('rubric_weights').$type<RubricWeights>().notNull(),
  profile: jsonb('profile').$type<Profile>().notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('app_settings_singleton', sql`${t.id}`),
  // A backstop against all-zero weights, which would divide by zero in
  // weightedTotal and store NaN. It is only a backstop: if the JSON object is
  // missing a key the `->>` yields NULL, the whole sum is NULL, and Postgres
  // treats a NULL CHECK as satisfied. The real guarantee that all five keys
  // are present is RubricWeightsSchema — `.strict()`, every key required, plus
  // a refine for at least one above zero — on the write path.
  check('app_settings_weights_nonzero', sql`
    (${t.rubricWeights}->>'coreStack')::int + (${t.rubricWeights}->>'seniority')::int +
    (${t.rubricWeights}->>'domain')::int + (${t.rubricWeights}->>'logistics')::int +
    (${t.rubricWeights}->>'growth')::int > 0`),
]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: sourceKindEnum('kind').notNull(),
  board: text('board'),
  slug: text('slug'),
  url: text('url'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('sources_ats_has_board_and_slug',
    sql`(${t.kind} = 'ats') = (${t.board} IS NOT NULL) AND (${t.kind} = 'ats') = (${t.slug} IS NOT NULL)`),
  check('sources_url_only_for_non_ats',
    sql`(${t.kind} = 'ats') = (${t.url} IS NULL)`),
  // NULLS NOT DISTINCT makes ON CONFLICT DO NOTHING work for rows whose
  // identity columns are null; without it every djinni row is "distinct".
  unique('sources_identity_uniq').on(t.kind, t.board, t.slug, t.url).nullsNotDistinct(),
]);
