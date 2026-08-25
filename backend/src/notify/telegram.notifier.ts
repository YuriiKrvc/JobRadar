import { Injectable } from '@nestjs/common';
import type { PendingNotification } from '../db/postings.repository';
import type { Notifier, TelegramOptions } from './types';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatMessage(item: PendingNotification): string {
  const e = escapeHtml;
  return [
    `<b>${item.verdict} · ${item.total}</b>`,
    `<b>${e(item.title)}</b> — ${e(item.company)}`,
    item.location ? e(item.location) : null,
    '',
    e(item.reasoning),
    '',
    item.url,
  ].filter((l) => l !== null).join('\n');
}

@Injectable()
export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram';

  constructor(
    private readonly opts: TelegramOptions,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(item: PendingNotification): Promise<void> {
    const res = await this.fetchFn(
      `https://api.telegram.org/bot${this.opts.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.opts.chatId,
          text: formatMessage(item),
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      },
    );

    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json() as { ok?: boolean; description?: string };
    if (json.ok !== true) throw new Error(`Telegram error: ${json.description ?? 'unknown'}`);
  }
}
