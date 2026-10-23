import { beforeEach, describe, expect, it, vi } from 'vitest';

const predictionMocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  find: vi.fn(),
  bulkWrite: vi.fn(),
  updateMany: vi.fn(),
  updateOne: vi.fn(),
}));
vi.mock('../src/models/prediction.js', () => ({ Prediction: predictionMocks }));

import {
  registerPrediction,
  scorePrediction,
  settlePredictions,
} from '../src/football/predictions.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch } from '../src/football/types.js';

const team = (name: string, isBotafogo = false) => ({ id: name, name, isBotafogo });
const match = (overrides: Partial<FootballMatch> = {}): FootballMatch => ({
  id: 'espn:10',
  competition: 'Brasileirão Série A',
  phase: null,
  kickoffAt: '2026-10-24T19:30:00.000Z',
  date: '2026-10-24',
  time: '16:30',
  status: 'scheduled',
  liveDetail: null,
  venue: null,
  broadcasts: [],
  homeTeam: team('Internacional'),
  awayTeam: team('Botafogo', true),
  score: { home: null, away: null },
  ...overrides,
});

describe('bolão', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [{ homeGoals: 1, awayGoals: 2 }, { home: 1, away: 2 }, 3, true],
    [{ homeGoals: 0, awayGoals: 1 }, { home: 1, away: 2 }, 1, false],
    [{ homeGoals: 1, awayGoals: 1 }, { home: 2, away: 2 }, 1, false],
    [{ homeGoals: 2, awayGoals: 0 }, { home: 1, away: 2 }, 0, false],
  ])('pontua %o com resultado %o', (prediction, result, points, exact) => {
    expect(scorePrediction(prediction, result)).toEqual({ points, exact });
  });

  it('registra o palpite com a temporada do jogo e recusa após o início', async () => {
    predictionMocks.updateOne.mockResolvedValue({ upsertedCount: 1 });
    const input = { userId: 2, topicId: 7, commentId: 12, home: 1, away: 2 };

    await expect(
      registerPrediction(input, match(), new Date('2026-10-24T12:00:00Z')),
    ).resolves.toMatchObject({ status: 'registered' });
    expect(predictionMocks.updateOne).toHaveBeenCalledWith(
      { matchId: 'espn:10', userId: '2' },
      expect.objectContaining({
        $set: expect.objectContaining({ homeGoals: 1, awayGoals: 2, season: 2026 }),
        $setOnInsert: { status: 'open' },
      }),
      { upsert: true },
    );

    await expect(
      registerPrediction(input, match(), new Date('2026-10-24T19:31:00Z')),
    ).resolves.toMatchObject({ status: 'closed' });
    await expect(registerPrediction(input, match({ id: 'ge:1' }))).resolves.toMatchObject({
      status: 'unsupported',
    });
    await expect(registerPrediction(input, null)).resolves.toEqual({ status: 'no-match' });
  });

  it('confere jogos encerrados e anula palpites enviados após o início', async () => {
    const kickoff = new Date('2026-10-24T19:30:00.000Z');
    predictionMocks.aggregate.mockResolvedValue([{ _id: 'espn:10' }]);
    predictionMocks.find.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            {
              _id: 'a',
              userId: '1',
              homeGoals: 0,
              awayGoals: 1,
              updatedAt: new Date('2026-10-24T10:00:00Z'),
            },
            {
              _id: 'b',
              userId: '2',
              homeGoals: 0,
              awayGoals: 3,
              updatedAt: new Date('2026-10-24T11:00:00Z'),
            },
            {
              _id: 'c',
              userId: '3',
              homeGoals: 2,
              awayGoals: 0,
              updatedAt: new Date('2026-10-24T12:00:00Z'),
            },
            {
              _id: 'd',
              userId: '4',
              homeGoals: 0,
              awayGoals: 1,
              updatedAt: new Date(kickoff.getTime() + 5 * 60_000),
            },
          ]),
      }),
    });
    const football = {
      getMatchReport: vi.fn().mockResolvedValue({
        match: match({ status: 'finished', score: { home: 0, away: 1 } }),
        goals: [],
        lineups: [],
      }),
    } as unknown as FootballService;

    const [summary] = await settlePredictions(football, new Date('2026-10-24T22:00:00Z'));

    expect(summary).toEqual({
      matchId: 'espn:10',
      scoreLine: 'Internacional 0 x 1 Botafogo',
      total: 4,
      exactUserIds: ['1'],
      outcomeCount: 1,
    });
    const operations = predictionMocks.bulkWrite.mock.calls[0]?.[0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
    }>;
    const byId = Object.fromEntries(
      operations.map((op) => [op.updateOne.filter._id, op.updateOne.update.$set]),
    );
    expect(byId.a).toMatchObject({ status: 'settled', points: 3, exact: true });
    expect(byId.b).toMatchObject({ status: 'settled', points: 1, exact: false });
    expect(byId.c).toMatchObject({ status: 'settled', points: 0 });
    expect(byId.d).toMatchObject({ status: 'void', points: 0 });
  });

  it('adia a conferência quando o jogo foi remarcado', async () => {
    predictionMocks.aggregate.mockResolvedValue([{ _id: 'espn:10' }]);
    const newKickoff = '2026-10-30T22:00:00.000Z';
    const football = {
      getMatchReport: vi.fn().mockResolvedValue({
        match: match({ status: 'postponed', kickoffAt: newKickoff }),
        goals: [],
        lineups: [],
      }),
    } as unknown as FootballService;

    await expect(settlePredictions(football, new Date('2026-10-24T22:00:00Z'))).resolves.toEqual(
      [],
    );
    expect(predictionMocks.updateMany).toHaveBeenCalledWith(
      { matchId: 'espn:10', status: 'open' },
      { $set: { kickoffAt: new Date(newKickoff) } },
    );
    expect(predictionMocks.bulkWrite).not.toHaveBeenCalled();
  });
});
