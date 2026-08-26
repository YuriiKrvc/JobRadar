import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { ZodValidationPipe } from '../api/zod-validation.pipe';
import {
  CvBodySchema, ProfileBodySchema, ProfileSchema, RubricBodySchema,
  type Profile, type RubricWeights,
} from './schema';

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly repo: SettingsRepository) {}

  @Get()
  async read() {
    const row = await this.repo.readRow();
    // Explicit projection: `id` is the singleton marker and never leaves here.
    return {
      cv: row.cv,
      rubricBody: row.rubricBody,
      rubricWeights: row.rubricWeights,
      // Lenient parse, not a straight jsonb read — the same guard
      // SettingsService.load() applies, and needed here independently of it:
      // this is the API read path, and it is the only one the dashboard sees.
      // A row written before the blocked-word fields existed has no such keys,
      // and handing `undefined` to ChipInput's value.map() unmounts the whole
      // app. The worker parsing its own copy does nothing for that.
      profile: ProfileSchema.parse(row.profile),
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Three endpoints rather than one combined PUT: it matches a per-section Save
  // button and makes one version bump per save fall out without diff logic.

  @Put('cv')
  async putCv(@Body(new ZodValidationPipe(CvBodySchema)) body: { cv: string }) {
    await this.repo.updateCv(body.cv);
    return { version: (await this.repo.readRow()).version };
  }

  @Put('rubric')
  async putRubric(
    @Body(new ZodValidationPipe(RubricBodySchema)) body: { body: string; weights: RubricWeights },
  ) {
    await this.repo.updateRubric(body.body, body.weights);
    return { version: (await this.repo.readRow()).version };
  }

  @Put('profile')
  async putProfile(@Body(new ZodValidationPipe(ProfileBodySchema)) profile: Profile) {
    await this.repo.updateProfile(profile);
    return { version: (await this.repo.readRow()).version };
  }
}
