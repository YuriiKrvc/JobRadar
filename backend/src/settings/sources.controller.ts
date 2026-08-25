import {
  Body, ConflictException, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { ZodValidationPipe } from '../api/zod-validation.pipe';
import { EnabledBodySchema, SourceInputSchema, type SourceInput } from './schema';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

@Controller('api/sources')
export class SourcesController {
  constructor(private readonly repo: SettingsRepository) {}

  @Get()
  async list() {
    // Disabled rows are included: the dashboard must be able to re-enable them.
    return { sources: await this.repo.listSources() };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(SourceInputSchema)) input: SourceInput) {
    try {
      return { source: await this.repo.addSource(input) };
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('That source is already configured');
      }
      throw err;
    }
  }

  @Patch(':id')
  async toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(EnabledBodySchema)) body: { enabled: boolean },
  ) {
    const source = await this.repo.setSourceEnabled(id, body.enabled);
    if (!source) throw new NotFoundException('No such source');
    return { source };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!await this.repo.deleteSource(id)) throw new NotFoundException('No such source');
  }
}
