import { beforeEach, describe, expect, it, vi } from 'vitest';

const reminderMocks = vi.hoisted(() => ({ find: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/models/reminder.js', () => ({ Reminder: reminderMocks }));

import type { BrasileiraoCompetition } from '../src/clients/brasileirao.js';
import type { FootballMatch, FootballSchedule } from '../src/clients/football-schedule.js';
import type { VkClient } from '../src/clients/vk.js';
import { executeCommand } from '../src/commands/execute.js';
import {
  formatAgenda,
  formatBotafogoGame,
  formatBrasileiraoTable,
} from '../src/commands/sports.js';

const now = new Date('2026-08-02T15:00:00.000Z');
const footballTeam = (id: number, popularName: string) => ({ id, name: popularName, popularName });
const match = (overrides: Partial<FootballMatch>): FootballMatch => ({
  id: 1,
  competition: 'Campeonato Brasileiro',
  phase: 'Fase única',
  round: 20,
  date: '2026-08-02',
  time: '18:30',
  status: 'scheduled',
  venue: 'Maracanã',
  homeTeam: footballTeam(262, 'Flamengo'),
  awayTeam: footballTeam(277, 'Santos'),
  score: { home: null, away: null },
  ...overrides,
});

const schedule: FootballSchedule = {
  matches: [
    match({ id: 1 }),
    match({
      id: 2,
      competition: 'Copa do Brasil',
      phase: 'Oitavas de final',
      round: null,
      date: '2026-08-03',
      time: '21:00',
      venue: 'Nilton Santos',
      homeTeam: footballTeam(263, 'Botafogo'),
      awayTeam: footballTeam(266, 'Fluminense'),
    }),
  ],
};

const tableTeam = (name: string, shortName: string) => ({ id: 1, name, shortName });
const tableEntry = (position: number, name: string, shortName: string, points: number) => ({
  position,
  team: tableTeam(name, shortName),
  points,
  matches: 20,
  wins: 10,
  draws: 5,
  losses: 5,
  goalsFor: 30,
  goalsAgainst: 20,
  goalDifference: 10,
});
const competition: BrasileiraoCompetition = {
  competition: { name: 'Campeonato Brasileiro 2026' },
  tables: [
    {
      id: 'overall',
      name: 'Classificação geral',
      round: { number: 20, label: '20ª rodada' },
      entries: [
        tableEntry(1, 'Palmeiras', 'PAL', 40),
        tableEntry(2, 'Flamengo', 'FLA', 38),
        tableEntry(3, 'Botafogo', 'BOT', 36),
        tableEntry(4, 'Bahia', 'BAH', 34),
        tableEntry(5, 'Santos', 'SAN', 32),
      ],
    },
  ],
  rounds: [],
};

describe('comandos esportivos', () => {
  it('formata o próximo jogo do Botafogo com a competição', () => {
    const message = formatBotafogoGame(schedule, now);
    expect(message).toContain('Próximo jogo do Botafogo — Copa do Brasil');
    expect(message).toContain('Botafogo x Fluminense');
    expect(message).toContain('Nilton Santos');
  });

  it('filtra a agenda de hoje, amanhã e do Botafogo', () => {
    expect(formatAgenda(schedule, 'today', now)).toContain('Flamengo x Santos');
    expect(formatAgenda(schedule, 'today', now)).not.toContain('Botafogo x Fluminense');
    expect(formatAgenda(schedule, 'tomorrow', now)).toContain('Botafogo x Fluminense');
    expect(formatAgenda(schedule, 'botafogo', now)).toContain('Botafogo x Fluminense');
  });

  it('mostra o Botafogo e os vizinhos na tabela', () => {
    const message = formatBrasileiraoTable(competition);
    expect(message).toContain('1º Palmeiras');
    expect(message).toContain('➡️ 3º Botafogo — 36 pts');
    expect(message).toContain('5º Santos');
  });
});

describe('execução dos novos comandos', () => {
  const createComment = vi.fn().mockResolvedValue(99);
  const vk = { createComment } as unknown as VkClient;
  const context = {
    topicId: 7,
    commentId: 12,
    userId: 2,
    topicTitle: 'Jogo',
    authorName: 'Bia',
  };

  beforeEach(() => vi.clearAllMocks());

  it('usa a agenda do Botafogo para !jogo', async () => {
    const getBotafogoSchedule = vi.fn().mockResolvedValue(schedule);
    await executeCommand({ kind: 'game' }, context, { vk, now: () => now, getBotafogoSchedule });

    expect(getBotafogoSchedule).toHaveBeenCalledOnce();
    expect(createComment).toHaveBeenCalledWith(
      7,
      12,
      expect.stringContaining('Botafogo x Fluminense'),
      expect.stringContaining('reply:game'),
    );
  });

  it('usa a agenda geral para !agenda amanhã', async () => {
    const getDailyFootballSchedule = vi.fn().mockResolvedValue(schedule);
    await executeCommand({ kind: 'agenda', scope: 'tomorrow' }, context, {
      vk,
      now: () => now,
      getDailyFootballSchedule,
    });
    expect(getDailyFootballSchedule).toHaveBeenCalledOnce();
    expect(createComment).toHaveBeenCalledWith(
      7,
      12,
      expect.stringContaining('Botafogo x Fluminense'),
      expect.stringContaining('reply:agenda'),
    );
  });

  it('lista somente os lembretes pendentes do usuário', async () => {
    const query = {
      sort: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn().mockResolvedValue([
        {
          topicId: '7',
          messageId: '50',
          userId: '2',
          remindAt: new Date('2026-08-03T15:00:00.000Z'),
          status: 'pending',
        },
      ]),
    };
    query.sort.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    reminderMocks.find.mockReturnValue(query);

    await executeCommand({ kind: 'reminders' }, context, { vk, now: () => now });

    expect(reminderMocks.find).toHaveBeenCalledWith(expect.objectContaining({ userId: '2' }));
    expect(createComment).toHaveBeenCalledWith(
      7,
      12,
      expect.stringContaining('seus lembretes pendentes'),
      expect.stringContaining('reply:reminders'),
    );
  });
});
