import { Test } from '@nestjs/testing';
import { WorkerService } from './worker.service';
import { PipelineService } from '../pipeline/pipeline.service';

const summary = {
  fetched: 1, skippedDuplicate: 0, hardFiltered: 0, classified: 1,
  classifyErrors: 0, notified: 0, notifyErrors: 0, sourceErrors: 0,
};

async function build(run: () => Promise<any>) {
  const moduleRef = await Test.createTestingModule({
    providers: [WorkerService, { provide: PipelineService, useValue: { run } }],
  }).compile();
  return moduleRef.get(WorkerService);
}

describe('WorkerService', () => {
  it('runs the pipeline on tick', async () => {
    const run = jest.fn(async () => summary);
    await (await build(run)).tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('swallows a thrown pipeline so the scheduler survives', async () => {
    const run = jest.fn(async () => { throw new Error('exploded'); });
    const svc = await build(run);
    await expect(svc.tick()).resolves.toBeUndefined();
  });

  it('skips a tick while a previous run is still active', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const run = jest.fn(async () => { await gate; return summary; });
    const svc = await build(run);

    const first = svc.tick();
    await svc.tick();                    // must not start a second run
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await first;
    await svc.tick();                    // free again
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('clears the running flag even when the run throws', async () => {
    const run = jest.fn(async () => { throw new Error('boom'); });
    const svc = await build(run);
    await svc.tick();
    await svc.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
