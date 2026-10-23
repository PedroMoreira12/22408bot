import { beforeEach, describe, expect, it, vi } from 'vitest';

const feedMocks = vi.hoisted(() => ({ find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/models/match-feed.js', () => ({ MatchFeed: feedMocks }));

import type { VkClient } from '../src/clients/vk.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch, MatchReport } from '../src/football/types.js';
import { postBolaoSummaries, runMatchFeed } from '../src/jobs/match-feed.js';

const kickoff = '2026-10-24T19:30:00.000Z';
const team = (name: string, isBotafogo = false) => ({ id: name, name, isBotafogo });
const match = (overrides: Partial<FootballMatch> = {}): FootballMatch => ({
  id: 'espn:10',
  competition: 'Brasileirão Série A',
  phase: null,
  kickoffAt: kickoff,
  date: '2026-10-24',
  time: '16:30',
  status: 'scheduled',
  liveDetail: null,
  venue: 'Beira-Rio',
  broadcasts: [],
  homeTeam: team('Internacional'),
  awayTeam: team('Botafogo', true),
  score: { home: null, away: null },
  ...overrides,
});
const report = (overrides: Partial<MatchReport> = {}): MatchReport => ({
  match: match({ status: 'live', score: { home: 0, away: 1 } }),
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
  ...overrides,
});

function lean<T>(value: T) {
  return { lean: () => Promise.resolve(value) };
}

describe('feed automático do jogo', () => {
  const createComment = vi.fn().mockResolvedValue(1);
  const vk = {
    createComment,
    getUserFirstNames: vi.fn().mockResolvedValue(new Map([[1, 'Ana']])),
  } as unknown as VkClient;
  const football = (upcoming: FootballMatch[], matchReport: MatchReport | null = null) =>
    ({
      getUpcomingBotafogoMatches: vi.fn().mockResolvedValue(upcoming),
      getBroadcasts: vi.fn().mockResolvedValue({
        broadcasts: [{ name: 'Globo', kind: 'open-tv' }],
        source: 'futebolnatv',
      }),
      getMatchReport: vi.fn().mockResolvedValue(matchReport),
    }) as unknown as FootballService;
  const messages = (): string[] => createComment.mock.calls.map((call) => String(call[2]));

  beforeEach(() => {
    vi.clearAllMocks();
    feedMocks.find.mockReturnValue(lean([]));
    feedMocks.updateOne.mockResolvedValue({ acknowledged: true });
  });

  it('publica a chamada do dia de jogo duas horas antes', async () => {
    feedMocks.findOne.mockReturnValue(lean(null));
    const result = await runMatchFeed(
      vk,
      football([match()]),
      55,
      Date.now() + 10_000,
      new Date('2026-10-24T18:00:00Z'),
    );

    expect(result.posts).toBe(1);
    expect(createComment).toHaveBeenCalledWith(
      55,
      null,
      expect.any(String),
      'feed:espn:10:pregame',
    );
    expect(messages()[0]).toContain('🔥 É DIA DE JOGO, ALVINEGRO!');
    expect(messages()[0]).toContain('📺 TV aberta: Globo');
  });

  it('publica cada gol uma única vez e o placar final', async () => {
    feedMocks.findOne.mockReturnValue(
      lean({ kickoffAt: new Date(kickoff), pregamePostedAt: new Date(), postedGoalIds: [] }),
    );
    await runMatchFeed(
      vk,
      football([match({ status: 'live' })], report()),
      55,
      Date.now() + 10_000,
      new Date('2026-10-24T20:00:00Z'),
    );
    expect(messages()).toEqual([
      "⚽ GOOOOL DO BOTAFOGO! Igor Jesus, 23'\n📊 Internacional 0 x 1 Botafogo",
    ]);
    expect(feedMocks.updateOne).toHaveBeenCalledWith(
      { matchId: 'espn:10', topicId: '55' },
      { $addToSet: { postedGoalIds: { $each: ['g1'] } } },
    );

    createComment.mockClear();
    feedMocks.find.mockReturnValue(lean([{ matchId: 'espn:10' }]));
    feedMocks.findOne.mockReturnValue(
      lean({ kickoffAt: new Date(kickoff), pregamePostedAt: new Date(), postedGoalIds: ['g1'] }),
    );
    const finished = report({ match: match({ status: 'finished', score: { home: 0, away: 1 } }) });
    await runMatchFeed(
      vk,
      football([], finished),
      55,
      Date.now() + 10_000,
      new Date('2026-10-24T21:30:00Z'),
    );
    expect(messages()).toEqual([
      "🏁 Fim de jogo: Internacional 0 x 1 Botafogo ✅\n⚽ Botafogo: Igor Jesus 23'\n🎯 O bolão é conferido em instantes. Ranking: !bolao",
    ]);
  });

  it('publica o resumo do bolão uma vez por jogo', async () => {
    feedMocks.findOne.mockReturnValue(lean(null));
    await postBolaoSummaries(vk, 55, [
      {
        matchId: 'espn:10',
        scoreLine: 'Internacional 0 x 1 Botafogo',
        total: 4,
        exactUserIds: ['1'],
        outcomeCount: 2,
      },
    ]);
    expect(createComment).toHaveBeenCalledWith(
      55,
      null,
      '🎯 Bolão conferido — Internacional 0 x 1 Botafogo\n✅ Placar exato: Ana\n👍 Acertaram o resultado: 2\n📊 4 palpite(s). Veja o ranking com !bolao',
      'feed:espn:10:bolao',
    );

    createComment.mockClear();
    feedMocks.findOne.mockReturnValue(lean({ bolaoPostedAt: new Date() }));
    await postBolaoSummaries(vk, 55, [
      { matchId: 'espn:10', scoreLine: 'x', total: 4, exactUserIds: [], outcomeCount: 0 },
    ]);
    expect(createComment).not.toHaveBeenCalled();
  });
});
