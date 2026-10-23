import { beforeEach, describe, expect, it, vi } from 'vitest';

const alertMocks = vi.hoisted(() => ({ find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/models/game-alert.js', () => ({ GameAlert: alertMocks }));

import type { VkClient } from '../src/clients/vk.js';
import { subscribeGameAlert } from '../src/football/game-alerts.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch } from '../src/football/types.js';
import { processGameAlerts } from '../src/jobs/process-game-alerts.js';

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
  venue: null,
  broadcasts: [],
  homeTeam: team('Internacional'),
  awayTeam: team('Botafogo', true),
  score: { home: null, away: null },
  ...overrides,
});
const alert = (overrides: Record<string, unknown> = {}) => ({
  _id: 'alert-1',
  matchId: 'espn:10',
  userId: '2',
  topicId: '7',
  commentId: '12',
  homeTeam: 'Internacional',
  awayTeam: 'Botafogo',
  competition: 'Brasileirão Série A',
  kickoffAt: new Date(kickoff),
  status: 'pending',
  attempts: 0,
  ...overrides,
});

function pending(alerts: unknown[]): void {
  alertMocks.find.mockReturnValue({
    sort: () => ({ limit: () => ({ lean: () => Promise.resolve(alerts) }) }),
  });
}

describe('avisos de jogo', () => {
  const createComment = vi.fn().mockResolvedValue(1);
  const vk = {
    createComment,
    getUserFirstNames: vi.fn().mockResolvedValue(new Map([[2, 'Bia']])),
  } as unknown as VkClient;
  const football = (fixtures: FootballMatch[]) =>
    ({
      getUpcomingBotafogoMatches: vi.fn().mockResolvedValue(fixtures),
      getBroadcasts: vi.fn().mockResolvedValue({
        broadcasts: [{ name: 'Globo', kind: 'open-tv' }],
        source: 'futebolnatv',
      }),
    }) as unknown as FootballService;

  beforeEach(() => {
    vi.clearAllMocks();
    alertMocks.updateOne.mockResolvedValue({ acknowledged: true });
  });

  it('não chama fontes externas sem avisos pendentes', async () => {
    pending([]);
    const service = football([]);
    await expect(processGameAlerts(vk, service, Date.now() + 10_000)).resolves.toEqual({
      sent: 0,
      failed: 0,
      expired: 0,
    });
    expect(service.getUpcomingBotafogoMatches).not.toHaveBeenCalled();
  });

  it('marca o autor 30 minutos antes com os canais', async () => {
    pending([alert()]);
    const result = await processGameAlerts(
      vk,
      football([match()]),
      Date.now() + 10_000,
      new Date('2026-10-24T19:05:00Z'),
    );

    expect(result).toEqual({ sent: 1, failed: 0, expired: 0 });
    expect(createComment).toHaveBeenCalledWith(
      7,
      12,
      '[post12|Bia], ⏰ Falta pouco! Internacional x Botafogo começa às 16:30 (Brasileirão Série A).\n📺 TV aberta: Globo\n📡 Fonte dos canais: futebolnatv.com.br',
      'game-alert:espn:10:2',
    );
    expect(alertMocks.updateOne).toHaveBeenCalledWith(
      { _id: 'alert-1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'sent' }) }),
    );
  });

  it('acompanha a mudança de horário e não avisa cedo demais', async () => {
    pending([alert()]);
    const moved = match({ kickoffAt: '2026-10-24T22:00:00.000Z', time: '19:00' });
    const result = await processGameAlerts(
      vk,
      football([moved]),
      Date.now() + 10_000,
      new Date('2026-10-24T19:05:00Z'),
    );

    expect(result.sent).toBe(0);
    expect(alertMocks.updateOne).toHaveBeenCalledWith(
      { _id: 'alert-1' },
      { $set: { kickoffAt: new Date('2026-10-24T22:00:00.000Z') } },
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it('descarta avisos que perderam o horário', async () => {
    pending([alert()]);
    const result = await processGameAlerts(
      vk,
      football([]),
      Date.now() + 10_000,
      new Date('2026-10-24T20:00:00Z'),
    );
    expect(result).toEqual({ sent: 0, failed: 0, expired: 1 });
    expect(createComment).not.toHaveBeenCalled();
  });

  it('inscreve somente uma vez por jogo', async () => {
    const now = new Date('2026-10-23T12:00:00Z');
    alertMocks.findOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ status: 'pending' }) }),
    });
    await expect(
      subscribeGameAlert({ userId: 2, topicId: 7, commentId: 12 }, match(), now),
    ).resolves.toMatchObject({ status: 'exists' });

    alertMocks.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    await expect(
      subscribeGameAlert({ userId: 2, topicId: 7, commentId: 12 }, match(), now),
    ).resolves.toMatchObject({ status: 'created' });
    expect(alertMocks.updateOne).toHaveBeenCalledWith(
      { matchId: 'espn:10', userId: '2' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'pending' }) }),
      { upsert: true },
    );
  });
});
