import {
  Body, ConflictException, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put,
} from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { ZodValidationPipe } from '../api/zod-validation.pipe';
import { EnabledBodySchema, SourceInputSchema, type SourceInput } from './schema';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * The `sources` table has two unique constraints — `sources_url_uniq` and
 * `sources_name_uniq` — so a bare 23505 is ambiguous. Both POST and PUT map
 * through here so a violation always names which one collided.
 */
function conflictOf(err: unknown): ConflictException | null {
  const e = err as { code?: string; constraint_name?: string; constraint?: string };
  if (e.code !== UNIQUE_VIOLATION) return null;
  const constraint = e.constraint_name ?? e.constraint ?? '';
  return new ConflictException(
    constraint.includes('name')
      ? 'Another source already uses that name'
      : 'Another source already uses that URL',
  );
}

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
      throw conflictOf(err) ?? err;
    }
  }

  @Put(':id')
  async replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SourceInputSchema)) input: SourceInput,
  ) {
    let source;
    try {
      source = await this.repo.replaceSource(id, input);
    } catch (err) {
      throw conflictOf(err) ?? err;
    }
    if (!source) throw new NotFoundException('No such source');
    return { source };
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
