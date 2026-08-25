import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { ZodValidationPipe } from '../api/zod-validation.pipe';
import {
  CvBodySchema, ProfileSchema, RubricBodySchema,
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
      profile: row.profile,
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
  async putProfile(@Body(new ZodValidationPipe(ProfileSchema)) profile: Profile) {
    await this.repo.updateProfile(profile);
    return { version: (await this.repo.readRow()).version };
  }
}
