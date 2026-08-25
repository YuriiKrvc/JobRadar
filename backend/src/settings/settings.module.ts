import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';
import { SourcesController } from './sources.controller';

// Global because the pipeline, the classifier, and the API all need it, and
// this replaces AppConfigModule, which was Global for the same reason.
@Global()
@Module({
  controllers: [SettingsController, SourcesController],
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
