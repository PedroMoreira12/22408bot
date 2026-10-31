import { beforeEach, describe, expect, it, vi } from 'vitest';

const topicMocks = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));
const predictionMocks = vi.hoisted(() => ({ ranking: vi.fn() }));
vi.mock('../src/models/pregame-topic.js', () => ({ PregameTopic: topicMocks }));
vi.mock('../src/football/predictions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Predictions>()),
  getPredictionRanking: predictionMocks.ranking,
}));

import type { VkClient } from '../src/clients/vk.js';
import type * as Predictions from '../src/football/predictions.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch } from '../src/football/types.js';
import { publishPregameTopic } from '../src/jobs/pregame-topic.js';

// Sábado, 31/10, às 21:00 em São Paulo; o tópico abre na sexta, 30/10, às 21:00.
const kickoff = new Date('2026-11-01T00:00:00.000Z');
const now = new Date(kickoff.getTime() - 24 * 60 * 60_000);
const team = (name: string, isBotafogo = false) => ({ id: name, name, isBotafogo });
const match = (overrides: Partial<FootballMatch> = {}): FootballMatch => ({
  id: 'espn:20',
  competition: 'Brasileirão Série A',
  phase: null,
  kickoffAt: kickoff.toISOString(),
  date: '2026-10-31',
  time: '21:00',
  status: 'scheduled',
  liveDetail: null,
  venue: 'Estádio Nilton Santos',
  broadcasts: [],
  homeTeam: team('Botafogo', true),
  awayTeam: team('Flamengo'),
  score: { home: null, away: null },
  ...overrides,
});
const title = '[ON] Palpites: Botafogo x Flamengo (31/10)';

function query<T>(value: T) {
  return { select: () => ({ lean: () => Promise.resolve(value) }) };
}

describe('tópico de palpites 24 horas antes do jogo', () => {
  const addTopic = vi.fn();
  const getTopics = vi.fn();
  const getUserFirstNames = vi.fn();
  const vk = { addTopic, getTopics, getUserFirstNames } as unknown as VkClient;
  const getNextBotafogoMatch = vi.fn();
  const getBroadcasts = vi.fn();
  const football = { getNextBotafogoMatch, getBroadcasts } as unknown as FootballService;

  beforeEach(() => {
    vi.clearAllMocks();
    getNextBotafogoMatch.mockResolvedValue(match());
    getBroadcasts.mockResolvedValue({
      broadcasts: [{ name: 'Globo', kind: 'open-tv' }],
      source: 'futebolnatv',
    });
    topicMocks.findOne.mockReturnValue(query(null));
    topicMocks.updateOne.mockResolvedValue({ acknowledged: true });
    predictionMocks.ranking.mockResolvedValue([
      { userId: '1', points: 12, exact: 3, predictions: 6 },
      { userId: '2', points: 7, exact: 1, predictions: 6 },
    ]);
    getUserFirstNames.mockResolvedValue(
      new Map([
        [1, 'Ana'],
        [2, 'Bia'],
        [3, 'Caio'],
      ]),
    );
    getTopics.mockResolvedValue({ count: 0, items: [] });
    addTopic.mockResolvedValue(888);
  });

  it('cria o tópico com o jogo, a chamada para palpites e o ranking do ano', async () => {
    await expect(publishPregameTopic(vk, football, now)).resolves.toEqual({ topics: 1 });

    expect(predictionMocks.ranking).toHaveBeenCalledTimes(1);
    expect(predictionMocks.ranking).toHaveBeenCalledWith(2026);
    expect(addTopic).toHaveBeenCalledWith(
      title,
      [
        '🔥 Tá chegando a hora, alvinegro! Este é o tópico dos palpites do próximo jogo.',
        '',
        '⚽ Próximo jogo do Botafogo — Brasileirão Série A',
        '⭐ Botafogo x Flamengo',
        '📅 Amanhã, 31/10 às 21:00 (faltam 1 dia)',
        '🏟️ Estádio Nilton Santos',
        '📺 TV aberta: Globo',
        '📡 Fonte dos canais: futebolnatv.com.br',
        '',
        '🎯 Deixe seu palpite aqui: !palpite 2x1 (= Botafogo 2 x 1 Flamengo)',
        '✏️ Dá para mudar até o apito inicial. Placar exato vale 3 pts; vencedor ou empate, 1 pt.',
        '',
        '🏆 Ranking do bolão 2026',
        '🥇 Ana — 12 pts (3 exato(s) em 6 palpite(s))',
        '🥈 Bia — 7 pts (1 exato(s) em 6 palpite(s))',
        '',
        '📌 Palpites do jogo: !palpites · Ranking completo: !bolao [ano] · Aviso 30 min antes: !avisar',
      ].join('\n'),
    );
    // A tentativa é gravada antes da escrita na VK, e o sucesso depois dela.
    expect(topicMocks.updateOne).toHaveBeenNthCalledWith(
      1,
      { matchId: 'espn:20' },
      {
        $inc: { attempts: 1 },
        $set: { kickoffAt: kickoff, retryAt: new Date(now.getTime() + 10 * 60_000) },
      },
      { upsert: true },
    );
    expect(topicMocks.updateOne).toHaveBeenNthCalledWith(
      2,
      { matchId: 'espn:20' },
      { $set: { topicId: '888', title, postedAt: now }, $unset: { lastError: 1 } },
    );
  });

  it('separa o ranking por ano: o ano do jogo completo e o pódio dos anos anteriores', async () => {
    const nextYear = new Date('2027-02-01T00:00:00.000Z');
    getNextBotafogoMatch.mockResolvedValue(
      match({ kickoffAt: nextYear.toISOString(), date: '2027-01-31' }),
    );
    predictionMocks.ranking.mockImplementation((season: number) =>
      Promise.resolve(
        season === 2027
          ? []
          : [1, 2, 3, 4].map((userId) => ({
              userId: String(userId),
              points: 20 - userId,
              exact: 1,
              predictions: 10,
            })),
      ),
    );

    await publishPregameTopic(vk, football, new Date(nextYear.getTime() - 60 * 60_000));

    expect(predictionMocks.ranking.mock.calls).toEqual([[2027], [2026]]);
    expect(getUserFirstNames).toHaveBeenCalledWith([1, 2, 3]);
    const text = addTopic.mock.calls[0]?.[1] as string;
    expect(text).toContain(
      [
        '🏆 Ranking do bolão 2027',
        'Ninguém pontuou ainda em 2027. Que tal ser o primeiro?',
        '',
        '📜 Pódio final do bolão 2026',
        '🥇 Ana — 19 pts (1 exato(s) em 10 palpite(s))',
        '🥈 Bia — 18 pts (1 exato(s) em 10 palpite(s))',
        '🥉 Caio — 17 pts (1 exato(s) em 10 palpite(s))',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('Membro');
  });

  it('só abre o tópico para jogos da ESPN com horário confirmado e dentro da janela', async () => {
    const outside = [
      match({ kickoffAt: new Date(now.getTime() + 24 * 60 * 60_000 + 60_000).toISOString() }),
      match({ kickoffAt: new Date(now.getTime() + 29 * 60_000).toISOString() }),
      match({ time: null }),
      match({ id: 'ge:20' }),
      match({ status: 'live' }),
      null,
    ];
    for (const candidate of outside) {
      getNextBotafogoMatch.mockResolvedValueOnce(candidate);
      await expect(publishPregameTopic(vk, football, now)).resolves.toEqual({ topics: 0 });
    }

    expect(topicMocks.findOne).not.toHaveBeenCalled();
    expect(addTopic).not.toHaveBeenCalled();
  });

  it('não repete tópicos já publicados nem tenta antes da hora ou além do limite', async () => {
    topicMocks.findOne.mockReturnValueOnce(query({ attempts: 1, postedAt: new Date() }));
    await publishPregameTopic(vk, football, now);
    topicMocks.findOne.mockReturnValueOnce(
      query({ attempts: 1, retryAt: new Date(now.getTime() + 60_000) }),
    );
    await publishPregameTopic(vk, football, now);
    topicMocks.findOne.mockReturnValueOnce(query({ attempts: 5 }));
    await publishPregameTopic(vk, football, now);

    expect(addTopic).not.toHaveBeenCalled();
    expect(topicMocks.updateOne).not.toHaveBeenCalled();
  });

  it('reaproveita o tópico criado por uma tentativa anterior', async () => {
    getTopics.mockResolvedValue({
      count: 1,
      items: [{ id: 999, title: '[ON] Palpites: Botafogo x Flamengo (31/10)', updated: 0 }],
    });
    await publishPregameTopic(vk, football, now);

    expect(addTopic).not.toHaveBeenCalled();
    expect(topicMocks.updateOne).toHaveBeenLastCalledWith(
      { matchId: 'espn:20' },
      expect.objectContaining({ $set: expect.objectContaining({ topicId: '999' }) }),
    );
  });

  it('registra a falha e tenta de novo depois, com intervalo crescente', async () => {
    topicMocks.findOne.mockReturnValue(
      query({ attempts: 2, retryAt: new Date(now.getTime() - 1) }),
    );
    getBroadcasts.mockRejectedValue(new Error('futebolnatv fora do ar'));
    addTopic.mockRejectedValue(new Error('VK API board.addTopic falhou (14): Captcha needed'));

    await expect(publishPregameTopic(vk, football, now)).resolves.toEqual({ topics: 0 });
    expect(topicMocks.updateOne).toHaveBeenNthCalledWith(
      1,
      { matchId: 'espn:20' },
      expect.objectContaining({
        $set: { kickoffAt: kickoff, retryAt: new Date(now.getTime() + 40 * 60_000) },
      }),
      { upsert: true },
    );
    expect(topicMocks.updateOne).toHaveBeenLastCalledWith(
      { matchId: 'espn:20' },
      { $set: { lastError: 'VK API board.addTopic falhou (14): Captcha needed' } },
    );
  });
});
