import { Module } from '@nestjs/common';
import { TelegramNotifier } from './telegram.notifier';
import { NOTIFIER, type Notifier } from './types';
import { NotifyConfig } from './notify.config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

@Module({
  providers: [
    NotifyConfig,
    {
      provide: NOTIFIER,
      useFactory: (): Notifier => new TelegramNotifier({
        botToken: required('TELEGRAM_BOT_TOKEN'),
        chatId: required('TELEGRAM_CHAT_ID'),
      }),
    },
  ],
  exports: [NOTIFIER, NotifyConfig],
})
export class NotifyModule {}
