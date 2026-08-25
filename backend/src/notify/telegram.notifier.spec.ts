import { TelegramNotifier } from './telegram.notifier';
import type { PendingNotification } from '../db/postings.repository';

const item: PendingNotification = {
  scoreId: 1, postingId: 'x:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', location: 'Remote - EU', total: 82, verdict: 'STRONG',
  reasoning: 'Stack matches; remote friendly.',
};

function capture(status = 200, body = '{"ok":true}') {
  const seen: any[] = [];
  const fetchFn = async (url: string, init?: any) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return new Response(body, { status });
  };
  return { seen, fetchFn: fetchFn as unknown as typeof fetch };
}

function notifier(fetchFn: typeof fetch, token = 'TOK', chat = '42') {
  return new TelegramNotifier({ botToken: token, chatId: chat }, fetchFn);
}

describe('TelegramNotifier', () => {
  it('posts to sendMessage with the bot token in the path', async () => {
    const { seen, fetchFn } = capture();
    await notifier(fetchFn).send(item);
    expect(seen[0].url).toBe('https://api.telegram.org/botTOK/sendMessage');
    expect(seen[0].body.chat_id).toBe('42');
  });

  it('includes verdict, total, title, company, reasoning, and url', async () => {
    const { seen, fetchFn } = capture();
    await notifier(fetchFn).send(item);
    const text: string = seen[0].body.text;
    for (const part of ['STRONG', '82', 'Senior Node Engineer', 'Acme', 'Stack matches', 'https://e.com/1']) {
      expect(text).toContain(part);
    }
  });

  it('escapes HTML-significant characters in posting fields', async () => {
    const { seen, fetchFn } = capture();
    await notifier(fetchFn).send({ ...item, company: 'A & B <Ltd>' });
    expect(seen[0].body.text).toContain('A &amp; B &lt;Ltd&gt;');
  });

  it('throws on a non-ok HTTP response', async () => {
    const { fetchFn } = capture(429, 'rate limited');
    await expect(notifier(fetchFn).send(item)).rejects.toThrow(/429/);
  });

  it('throws when Telegram reports ok:false', async () => {
    const { fetchFn } = capture(200, '{"ok":false,"description":"chat not found"}');
    await expect(notifier(fetchFn).send(item)).rejects.toThrow(/chat not found/);
  });

  it('reports its channel as telegram', () => {
    expect(notifier(capture().fetchFn).channel).toBe('telegram');
  });
});
