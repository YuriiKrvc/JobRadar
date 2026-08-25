import type { PendingNotification } from '../db/postings.repository';

export const NOTIFIER = Symbol('NOTIFIER');

export interface Notifier {
  readonly channel: string;
  send(item: PendingNotification): Promise<void>;
}

export interface TelegramOptions {
  botToken: string;
  chatId: string;
}
