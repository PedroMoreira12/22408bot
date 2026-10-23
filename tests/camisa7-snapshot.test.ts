import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({ exists: vi.fn(), updateOne: vi.fn(), findOne: vi.fn() }));
const stateMocks = vi.hoisted(() => ({ updateOne: vi.fn() }));
vi.mock('../src/models/camisa7-snapshot.js', () => ({ Camisa7Snapshot: snapshotMocks }));
vi.mock('../src/models/job-state.js', () => ({ JobState: stateMocks }));

import { ensureDailyCamisa7Snapshot, getCamisa7Trend } from '../src/jobs/camisa7-snapshot.js';

const now = new Date('2026-10-22T15:00:00Z');

describe('histórico do Camisa 7', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotMocks.updateOne.mockResolvedValue({ acknowledged: true });
  });

  it('registra uma contagem por dia e não repete', async () => {
    snapshotMocks.exists.mockResolvedValueOnce(null);
    stateMocks.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
    const getCount = vi.fn().mockResolvedValue(45_000);

    await expect(ensureDailyCamisa7Snapshot(now, getCount)).resolves.toBe('recorded');
    expect(snapshotMocks.updateOne).toHaveBeenCalledWith(
      { dateKey: '2026-10-22' },
      { $set: { count: 45_000, recordedAt: now } },
      { upsert: true },
    );

    snapshotMocks.exists.mockResolvedValueOnce({ _id: 'x' });
    await expect(ensureDailyCamisa7Snapshot(now, getCount)).resolves.toBe('skipped');
    expect(getCount).toHaveBeenCalledOnce();
  });

  it('espera 15 minutos entre tentativas quando a API falha', async () => {
    snapshotMocks.exists.mockResolvedValue(null);
    stateMocks.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const getCount = vi.fn();

    await expect(ensureDailyCamisa7Snapshot(now, getCount)).resolves.toBe('skipped');
    expect(getCount).not.toHaveBeenCalled();
  });

  it('compara com a contagem de pelo menos sete dias atrás', async () => {
    snapshotMocks.findOne.mockReturnValue({
      sort: () => ({ lean: () => Promise.resolve({ dateKey: '2026-10-14', count: 44_000 }) }),
    });
    await expect(getCamisa7Trend(now)).resolves.toEqual({
      previousCount: 44_000,
      sinceDateKey: '2026-10-14',
    });
    expect(snapshotMocks.findOne).toHaveBeenCalledWith({ dateKey: { $lte: '2026-10-15' } });
  });
});
