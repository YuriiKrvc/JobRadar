import {
  pgTable, pgEnum, text, integer, timestamp, jsonb, serial, index,
} from 'drizzle-orm/pg-core';
import type { SubScores } from '../types';

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
