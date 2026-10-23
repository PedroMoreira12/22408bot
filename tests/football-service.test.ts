import { describe, expect, it, vi } from 'vitest';

import { displayChannelName, normalizeBroadcasts } from '../src/football/channels.js';
import { DefaultFootballService, type FootballSources } from '../src/football/service.js';
import type { FootballMatch } from '../src/football/types.js';
import { formatCountdown } from '../src/lib/time.js';

const team = (name: string, isBotafogo = false) => ({ id: name, name, isBotafogo });
const match = (overrides: Partial<FootballMatch>): FootballMatch => ({
  id: 'espn:1',
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

function sources(
  overrides: Partial<{ [K in keyof FootballSources]: Partial<FootballSources[K]> }> = {},
) {
  return {
    espn: {
      getBotafogoFixtures: vi.fn().mockResolvedValue([match({})]),
      getBotafogoResults: vi.fn().mockResolvedValue([]),
      getBotafogoLiveMatches: vi.fn().mockResolvedValue([]),
      getLeagueMonth: vi.fn().mockResolvedValue([]),
      getMatchReport: vi.fn(),
      ...overrides.espn,
    },
    ge: {
      getBotafogoMatches: vi.fn().mockResolvedValue([]),
      getDailyMatches: vi.fn().mockResolvedValue([]),
      ...overrides.ge,
    },
    futebolNaTv: {
      getBotafogoListings: vi.fn().mockResolvedValue([]),
      ...overrides.futebolNaTv,
    },
    brasileirao: vi.fn(),
  } as unknown as FootballSources;
}

describe('DefaultFootballService', () => {
  it('usa a ESPN para o calendário e o ge como reserva', async () => {
    const geMatch = match({ id: 'ge:9' });
    const fallback = sources({
      espn: { getBotafogoFixtures: vi.fn().mockRejectedValue(new Error('fora do ar')) },
      ge: { getBotafogoMatches: vi.fn().mockResolvedValue([geMatch]) },
    });
    const service = new DefaultFootballService(fallback);

    await expect(service.getNextBotafogoMatch(new Date('2026-10-22T12:00:00Z'))).resolves.toBe(
      geMatch,
    );
  });

  it('prioriza o jogo em andamento e ignora jogos encerrados', async () => {
    const live = match({ id: 'espn:2', status: 'live', kickoffAt: '2026-10-24T19:30:00.000Z' });
    const service = new DefaultFootballService(
      sources({
        espn: {
          getBotafogoFixtures: vi
            .fn()
            .mockResolvedValue([
              match({ id: 'espn:0', status: 'finished' }),
              live,
              match({ id: 'espn:3' }),
            ]),
        },
      }),
    );
    await expect(service.getNextBotafogoMatch(new Date('2026-10-24T20:00:00Z'))).resolves.toBe(
      live,
    );
  });

  it('recupera o jogo em andamento quando ele sai da lista de próximos jogos', async () => {
    const live = match({ id: 'espn:2', status: 'live' });
    const service = new DefaultFootballService(
      sources({
        espn: {
          getBotafogoFixtures: vi
            .fn()
            .mockResolvedValue([match({ id: 'espn:3', kickoffAt: '2026-10-29T00:30:00.000Z' })]),
          getBotafogoLiveMatches: vi.fn().mockResolvedValue([live]),
        },
      }),
    );
    await expect(service.getNextBotafogoMatch(new Date('2026-10-24T20:00:00Z'))).resolves.toBe(
      live,
    );
  });

  it('busca canais no futebolnatv pelo horário e cai para o ge', async () => {
    const listing = {
      url: 'u',
      homeTeam: 'Internacional',
      awayTeam: 'Botafogo',
      kickoffAt: '2026-10-24T19:30:00.000Z',
      competition: null,
      broadcasts: [{ name: 'Globo', kind: 'open-tv' as const }],
    };
    const service = new DefaultFootballService(
      sources({ futebolNaTv: { getBotafogoListings: vi.fn().mockResolvedValue([listing]) } }),
    );
    await expect(service.getBroadcasts(match({}))).resolves.toEqual({
      broadcasts: listing.broadcasts,
      source: 'futebolnatv',
    });

    const geBroadcasts = [{ name: 'Premiere', kind: 'pay-tv' as const }];
    const withoutListing = new DefaultFootballService(
      sources({
        futebolNaTv: { getBotafogoListings: vi.fn().mockRejectedValue(new Error('403')) },
        ge: {
          getBotafogoMatches: vi
            .fn()
            .mockResolvedValue([match({ id: 'ge:1', broadcasts: geBroadcasts })]),
        },
      }),
    );
    await expect(withoutListing.getBroadcasts(match({}))).resolves.toEqual({
      broadcasts: geBroadcasts,
      source: 'ge',
    });
  });

  it('não confunde o Botafogo com o Botafogo-SP nem jogos de outro horário', async () => {
    const service = new DefaultFootballService(
      sources({
        futebolNaTv: {
          getBotafogoListings: vi.fn().mockResolvedValue([
            {
              url: 'a',
              homeTeam: 'Avaí',
              awayTeam: 'Botafogo-SP',
              kickoffAt: '2026-10-24T19:00:00.000Z',
              competition: null,
              broadcasts: [{ name: 'Disney+', kind: 'paid-streaming' }],
            },
            {
              url: 'b',
              homeTeam: 'Botafogo',
              awayTeam: 'Chapecoense',
              kickoffAt: '2026-10-17T21:00:00.000Z',
              competition: null,
              broadcasts: [{ name: 'Record', kind: 'open-tv' }],
            },
          ]),
        },
      }),
    );
    await expect(service.getBroadcasts(match({}))).resolves.toEqual({
      broadcasts: [],
      source: null,
    });
  });

  it('monta a agenda com as cinco competições e o mês seguinte no último dia', async () => {
    const getLeagueMonth = vi.fn().mockResolvedValue([match({ date: '2026-10-31' })]);
    const service = new DefaultFootballService(sources({ espn: { getLeagueMonth } }));

    const matches = await service.getAgendaMatches(['2026-10-31']);

    expect(matches).toHaveLength(1);
    expect(getLeagueMonth).toHaveBeenCalledTimes(10);
    expect(getLeagueMonth).toHaveBeenCalledWith('bra.1', '202610');
    expect(getLeagueMonth).toHaveBeenCalledWith('bra.1', '202611');
    expect(getLeagueMonth).toHaveBeenCalledWith('bra.camp.carioca', '202610');
  });

  it('usa a agenda do ge quando a ESPN falha', async () => {
    const service = new DefaultFootballService(
      sources({
        espn: { getLeagueMonth: vi.fn().mockRejectedValue(new Error('500')) },
        ge: {
          getDailyMatches: vi
            .fn()
            .mockResolvedValue([match({ id: 'ge:1' }), match({ id: 'ge:2', date: '2026-10-25' })]),
        },
      }),
    );
    const matches = await service.getAgendaMatches(['2026-10-24']);
    expect(matches.map((item) => item.id)).toEqual(['ge:1']);
  });
});

describe('canais e horários', () => {
  it('padroniza nomes, remove o Cartola e elimina duplicatas', () => {
    expect(
      normalizeBroadcasts([
        { name: 'PREMIERE 3' },
        { name: 'Cartola' },
        { name: 'CAZÉTV' },
        { name: 'YOUTUBE (SPORTYNET)' },
        { name: 'premiere 3' },
        { name: 'Canal Novo' },
      ]),
    ).toEqual([
      { name: 'Premiere 3', kind: 'pay-tv' },
      { name: 'CazéTV', kind: 'free-streaming' },
      { name: 'YouTube (SportyNet)', kind: 'free-streaming' },
      { name: 'Canal Novo', kind: 'other' },
    ]);
    expect(displayChannelName('PRIME VIDEO')).toBe('Prime Video');
  });

  it.each([
    ['2026-10-22T12:00:00Z', '2026-10-24T19:30:00Z', '2 dias e 7h'],
    ['2026-10-24T16:00:00Z', '2026-10-24T19:30:00Z', '3h30'],
    ['2026-10-24T19:05:00Z', '2026-10-24T19:30:00Z', '25 min'],
    ['2026-10-24T19:31:00Z', '2026-10-24T19:30:00Z', null],
  ])('conta o tempo de %s até %s', (from, to, expected) => {
    expect(formatCountdown(new Date(from), new Date(to))).toBe(expected);
  });
});
