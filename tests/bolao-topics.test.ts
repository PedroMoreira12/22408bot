import { beforeEach, describe, expect, it, vi } from 'vitest';

const predictionModelMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
const topicMocks = vi.hoisted(() => ({ find: vi.fn(), updateOne: vi.fn() }));
const predictionMocks = vi.hoisted(() => ({ list: vi.fn(), ranking: vi.fn() }));
vi.mock('../src/models/prediction.js', () => ({ Prediction: predictionModelMocks }));
vi.mock('../src/models/bolao-topic.js', () => ({ BolaoTopic: topicMocks }));
vi.mock('../src/football/predictions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Predictions>()),
  listMatchPredictions: predictionMocks.list,
  getPredictionRanking: predictionMocks.ranking,
}));

import type { VkClient } from '../src/clients/vk.js';
import type * as Predictions from '../src/football/predictions.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch, MatchReport } from '../src/football/types.js';
import { publishBolaoTopics } from '../src/jobs/bolao-topics.js';

const now = new Date('2026-10-24T22:00:00.000Z');
const kickoff = new Date('2026-10-24T19:30:00.000Z');
const team = (name: string, isBotafogo = false) => ({ id: name, name, isBotafogo });
const finished: FootballMatch = {
  id: 'espn:10',
  competition: 'Brasileirão Série A',
  phase: null,
  kickoffAt: kickoff.toISOString(),
  date: '2026-10-24',
  time: '16:30',
  status: 'finished',
  liveDetail: null,
  venue: null,
  broadcasts: [],
  homeTeam: team('Internacional'),
  awayTeam: team('Botafogo', true),
  score: { home: 0, away: 1 },
};
const report: MatchReport = {
  match: finished,
  goals: [
    {
      id: 'g1',
      minute: "23'",
      teamName: 'Botafogo',
      isBotafogo: true,
      scorer: 'Igor Jesus',
      penalty: false,
      ownGoal: false,
    },
  ],
  lineups: [],
};
const settled = (userId: string, homeGoals: number, awayGoals: number, points: number) => ({
  userId,
  homeGoals,
  awayGoals,
  status: 'settled' as const,
  points,
  exact: points === 3,
});

function query<T>(value: T) {
  return { select: () => ({ lean: () => Promise.resolve(value) }) };
}

describe('tópico com o resultado do bolão', () => {
  const addTopic = vi.fn();
  const getTopics = vi.fn();
  const vk = {
    addTopic,
    getTopics,
    getUserFirstNames: vi.fn().mockResolvedValue(
      new Map([
        [1, 'Ana'],
        [2, 'Bia'],
        [3, 'Caio'],
        [4, 'Duda'],
      ]),
    ),
  } as unknown as VkClient;
  const football = {
    getMatchReport: vi.fn().mockResolvedValue(report),
  } as unknown as FootballService;
  const deadline = () => Date.now() + 10_000;

  beforeEach(() => {
    vi.clearAllMocks();
    predictionModelMocks.aggregate.mockResolvedValue([{ _id: 'espn:10', kickoffAt: kickoff }]);
    topicMocks.find.mockReturnValue(query([]));
    topicMocks.updateOne.mockResolvedValue({ acknowledged: true });
    predictionMocks.list.mockResolvedValue([
      settled('1', 0, 1, 3),
      settled('2', 1, 2, 1),
      settled('3', 1, 1, 0),
      { userId: '4', homeGoals: 0, awayGoals: 1, status: 'void' as const, points: 0 },
    ]);
    predictionMocks.ranking.mockResolvedValue([
      { userId: '1', points: 12, exact: 3, predictions: 6 },
      { userId: '2', points: 7, exact: 1, predictions: 6 },
    ]);
    getTopics.mockResolvedValue({ count: 0, items: [] });
    addTopic.mockResolvedValue(555);
  });

  it('cria o tópico com placar, palpites e ranking quando houve palpites', async () => {
    await expect(publishBolaoTopics(vk, football, deadline(), now)).resolves.toEqual({
      topics: 1,
    });

    expect(predictionModelMocks.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          status: 'settled',
          kickoffAt: { $gte: new Date('2026-10-17T22:00:00.000Z') },
          settledAt: { $gte: new Date('2026-10-24T10:00:00.000Z') },
        },
      },
      expect.anything(),
      expect.anything(),
    ]);
    expect(predictionMocks.ranking).toHaveBeenCalledWith(2026);
    expect(addTopic).toHaveBeenCalledWith(
      '[ON] Bolão: Internacional 0 x 1 Botafogo (24/10)',
      [
        '🏁 Internacional 0 x 1 Botafogo ✅ vitória',
        '🏆 Brasileirão Série A · 24/10',
        "⚽ Botafogo: Igor Jesus 23'",
        '',
        '🎯 Bolão conferido: 3 palpite(s)',
        '✅ Cravaram o placar (+3): Ana',
        '👍 Acertaram o resultado (+1): 1',
        '❌ Erraram: 1',
        '⛔ Anulados (enviados depois do início): 1',
        '',
        '📋 Todos os palpites',
        '✅ 0 x 1 (1): Ana — +3',
        '👍 1 x 2 (1): Bia — +1',
        '❌ 1 x 1 (1): Caio',
        '',
        '🏆 Ranking do bolão 2026',
        '🥇 Ana — 12 pts (3 exato(s) em 6 palpite(s))',
        '🥈 Bia — 7 pts (1 exato(s) em 6 palpite(s))',
        '',
        '📌 Ranking completo: !bolao · Palpites do próximo jogo: !palpites',
      ].join('\n'),
    );
    // A tentativa é gravada antes da escrita na VK, e o sucesso depois dela.
    expect(topicMocks.updateOne).toHaveBeenNthCalledWith(
      1,
      { matchId: 'espn:10' },
      {
        $inc: { attempts: 1 },
        $set: { retryAt: new Date('2026-10-24T22:10:00.000Z') },
        $setOnInsert: { kickoffAt: kickoff },
      },
      { upsert: true },
    );
    expect(topicMocks.updateOne).toHaveBeenNthCalledWith(
      2,
      { matchId: 'espn:10' },
      {
        $set: {
          topicId: '555',
          title: '[ON] Bolão: Internacional 0 x 1 Botafogo (24/10)',
          postedAt: now,
        },
        $unset: { lastError: 1 },
      },
    );
  });

  it('não cria tópico sem palpites conferidos nem repete jogos já publicados', async () => {
    predictionModelMocks.aggregate.mockResolvedValue([]);
    await expect(publishBolaoTopics(vk, football, deadline(), now)).resolves.toEqual({
      topics: 0,
    });
    expect(topicMocks.find).not.toHaveBeenCalled();

    predictionModelMocks.aggregate.mockResolvedValue([{ _id: 'espn:10', kickoffAt: kickoff }]);
    topicMocks.find.mockReturnValue(
      query([{ matchId: 'espn:10', attempts: 1, postedAt: new Date() }]),
    );
    await publishBolaoTopics(vk, football, deadline(), now);

    topicMocks.find.mockReturnValue(
      query([{ matchId: 'espn:10', attempts: 1, retryAt: new Date(now.getTime() + 60_000) }]),
    );
    await publishBolaoTopics(vk, football, deadline(), now);

    topicMocks.find.mockReturnValue(query([{ matchId: 'espn:10', attempts: 5 }]));
    await publishBolaoTopics(vk, football, deadline(), now);

    expect(addTopic).not.toHaveBeenCalled();
    expect(topicMocks.updateOne).not.toHaveBeenCalled();
  });

  it('reaproveita o tópico criado por uma tentativa anterior', async () => {
    getTopics.mockResolvedValue({
      count: 1,
      items: [{ id: 777, title: '[ON] Bolão: Internacional 0 x 1 Botafogo (24/10)', updated: 0 }],
    });
    await publishBolaoTopics(vk, football, deadline(), now);

    expect(getTopics).toHaveBeenCalledWith(0, 50, 2);
    expect(addTopic).not.toHaveBeenCalled();
    expect(topicMocks.updateOne).toHaveBeenLastCalledWith(
      { matchId: 'espn:10' },
      expect.objectContaining({ $set: expect.objectContaining({ topicId: '777' }) }),
    );
  });

  it('registra a falha e tenta de novo depois, com intervalo crescente', async () => {
    topicMocks.find.mockReturnValue(
      query([{ matchId: 'espn:10', attempts: 2, retryAt: new Date(now.getTime() - 1) }]),
    );
    addTopic.mockRejectedValue(new Error('VK API board.addTopic falhou (14): Captcha needed'));

    await expect(publishBolaoTopics(vk, football, deadline(), now)).resolves.toEqual({
      topics: 0,
    });
    expect(topicMocks.updateOne).toHaveBeenNthCalledWith(
      1,
      { matchId: 'espn:10' },
      expect.objectContaining({ $set: { retryAt: new Date('2026-10-24T22:40:00.000Z') } }),
      { upsert: true },
    );
    expect(topicMocks.updateOne).toHaveBeenLastCalledWith(
      { matchId: 'espn:10' },
      { $set: { lastError: 'VK API board.addTopic falhou (14): Captcha needed' } },
    );
  });
});
