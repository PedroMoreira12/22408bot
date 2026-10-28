import { beforeEach, describe, expect, it, vi } from 'vitest';

const reminderMocks = vi.hoisted(() => ({ find: vi.fn(), updateOne: vi.fn() }));
const alertMocks = vi.hoisted(() => ({ subscribe: vi.fn(), cancel: vi.fn(), list: vi.fn() }));
const predictionMocks = vi.hoisted(() => ({
  register: vi.fn(),
  status: vi.fn(),
  ranking: vi.fn(),
  list: vi.fn(),
}));
const camisa7Mocks = vi.hoisted(() => ({ record: vi.fn(), trend: vi.fn() }));

vi.mock('../src/models/reminder.js', () => ({ Reminder: reminderMocks }));
vi.mock('../src/football/game-alerts.js', () => ({
  subscribeGameAlert: alertMocks.subscribe,
  cancelGameAlerts: alertMocks.cancel,
  listPendingGameAlerts: alertMocks.list,
}));
vi.mock('../src/football/predictions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Predictions>()),
  registerPrediction: predictionMocks.register,
  getPredictionStatus: predictionMocks.status,
  getPredictionRanking: predictionMocks.ranking,
  listMatchPredictions: predictionMocks.list,
}));
vi.mock('../src/jobs/camisa7-snapshot.js', () => ({
  recordCamisa7Snapshot: camisa7Mocks.record,
  getCamisa7Trend: camisa7Mocks.trend,
}));

import type { BrasileiraoCompetition } from '../src/clients/brasileirao.js';
import type * as Predictions from '../src/football/predictions.js';
import { VkApiError, type VkClient } from '../src/clients/vk.js';
import { tutorialMessage } from '../src/commands/content.js';
import { executeCommand } from '../src/commands/execute.js';
import {
  formatAgenda,
  formatBotafogoAgenda,
  formatBrasileiraoTable,
  formatLineups,
  formatNextGame,
  formatResult,
  formatRound,
  resolveAgendaWindow,
} from '../src/commands/sports.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch, MatchReport } from '../src/football/types.js';

// Domingo, 02/08/2026, 12:00 em São Paulo.
const now = new Date('2026-08-02T15:00:00.000Z');
const team = (name: string, isBotafogo = false) => ({ id: `t:${name}`, name, isBotafogo });
const match = (overrides: Partial<FootballMatch>): FootballMatch => ({
  id: 'espn:1',
  competition: 'Brasileirão Série A',
  phase: null,
  kickoffAt: '2026-08-02T21:30:00.000Z',
  date: '2026-08-02',
  time: '18:30',
  status: 'scheduled',
  liveDetail: null,
  venue: 'Maracanã',
  broadcasts: [],
  homeTeam: team('Flamengo'),
  awayTeam: team('Santos'),
  score: { home: null, away: null },
  ...overrides,
});
const botafogoGame = match({
  id: 'espn:2',
  competition: 'Copa do Brasil',
  phase: 'Oitavas de final — jogo de ida',
  kickoffAt: '2026-08-04T00:00:00.000Z',
  date: '2026-08-03',
  time: '21:00',
  venue: 'Nilton Santos',
  homeTeam: team('Botafogo', true),
  awayTeam: team('Fluminense'),
});
const lastGame = match({
  id: 'espn:3',
  status: 'finished',
  date: '2026-07-29',
  kickoffAt: '2026-07-29T22:00:00.000Z',
  homeTeam: team('Botafogo', true),
  awayTeam: team('Chapecoense'),
  score: { home: 2, away: 1 },
  venue: 'Nilton Santos',
});
const lastReport: MatchReport = {
  match: lastGame,
  goals: [
    {
      id: 'g1',
      minute: "7'",
      teamName: 'Botafogo',
      isBotafogo: true,
      scorer: 'Tiquinho',
      penalty: false,
      ownGoal: false,
    },
    {
      id: 'g2',
      minute: "40'",
      teamName: 'Chapecoense',
      isBotafogo: false,
      scorer: 'Perotti',
      penalty: true,
      ownGoal: false,
    },
    {
      id: 'g3',
      minute: "88'",
      teamName: 'Botafogo',
      isBotafogo: true,
      scorer: 'Savarino',
      penalty: false,
      ownGoal: false,
    },
  ],
  lineups: [
    {
      teamName: 'Botafogo',
      isBotafogo: true,
      formation: '4-2-3-1',
      starters: Array.from({ length: 11 }, (_, index) => `Jogador ${index + 1}`),
    },
  ],
};
const broadcasts = {
  broadcasts: [
    { name: 'Globo', kind: 'open-tv' as const },
    { name: 'Premiere 3', kind: 'pay-tv' as const },
    { name: 'CazéTV', kind: 'free-streaming' as const },
  ],
  source: 'futebolnatv' as const,
};

const tableEntry = (position: number, name: string, shortName: string, points: number) => ({
  position,
  team: { id: 1, name, shortName },
  points,
  matches: 20,
  wins: 10,
  draws: 5,
  losses: 5,
  goalsFor: 30,
  goalsAgainst: 20,
  goalDifference: 10,
});
const roundMatch = (
  home: string,
  away: string,
  score: [number | null, number | null],
  status: 'scheduled' | 'finished',
) => ({
  id: 1,
  round: 20,
  dateTime: null,
  date: '2026-08-02',
  time: '16:00',
  started: status !== 'scheduled',
  status,
  venue: null,
  homeTeam: { id: 1, name: home, shortName: home.slice(0, 3).toUpperCase() },
  awayTeam: { id: 2, name: away, shortName: away.slice(0, 3).toUpperCase() },
  score: { home: score[0], away: score[1] },
});
const competition: BrasileiraoCompetition = {
  competition: { name: 'Campeonato Brasileiro 2026' },
  tables: [
    {
      id: 'overall',
      name: 'Classificação geral',
      round: { number: 20, label: '20a rodada' },
      entries: [
        tableEntry(1, 'Palmeiras', 'PAL', 40),
        tableEntry(2, 'Flamengo', 'FLA', 38),
        tableEntry(3, 'Botafogo', 'BOT', 36),
        tableEntry(4, 'Bahia', 'BAH', 34),
        tableEntry(5, 'Santos', 'SAN', 32),
      ],
    },
  ],
  rounds: [
    {
      id: 'r20',
      number: 20,
      label: '20a rodada',
      matches: [
        roundMatch('Botafogo', 'Bahia', [null, null], 'scheduled'),
        roundMatch('Palmeiras', 'Santos', [2, 0], 'finished'),
      ],
    },
  ],
};

function fakeFootball(overrides: Partial<FootballService> = {}): FootballService {
  return {
    getUpcomingBotafogoMatches: vi.fn().mockResolvedValue([botafogoGame]),
    getNextBotafogoMatch: vi.fn().mockResolvedValue(botafogoGame),
    getRecentBotafogoResults: vi.fn().mockResolvedValue([lastGame]),
    getBroadcasts: vi.fn().mockResolvedValue(broadcasts),
    getMatchReport: vi.fn().mockResolvedValue(lastReport),
    getAgendaMatches: vi.fn().mockResolvedValue([match({}), botafogoGame]),
    getBrasileirao: vi.fn().mockResolvedValue(competition),
    ...overrides,
  };
}

describe('formatação dos comandos esportivos', () => {
  it('mostra o próximo jogo com contagem regressiva e canais por tipo', () => {
    const message = formatNextGame(botafogoGame, broadcasts, now);
    expect(message).toContain('⚽ Próximo jogo do Botafogo — Copa do Brasil');
    expect(message).toContain('⭐ Botafogo x Fluminense');
    expect(message).toContain('📅 Amanhã, 03/08 às 21:00 (faltam 1 dia e 9h)');
    expect(message).toContain('🏟️ Nilton Santos');
    expect(message).toContain('🏆 Oitavas de final — jogo de ida');
    expect(message).toContain('📺 TV aberta: Globo');
    expect(message).toContain('📺 TV por assinatura: Premiere 3');
    expect(message).toContain('📱 Streaming gratuito: CazéTV');
    expect(message).toContain('📡 Fonte dos canais: futebolnatv.com.br');
  });

  it('avisa quando a transmissão ainda não foi informada e quando o horário não saiu', () => {
    const message = formatNextGame(
      { ...botafogoGame, time: null },
      { broadcasts: [], source: null },
      now,
    );
    expect(message).toContain('📅 Amanhã, 03/08 — horário a definir');
    expect(message).toContain('📺 Onde assistir: transmissão ainda não informada');
  });

  it('destaca jogo em andamento com placar e minuto', () => {
    const live = {
      ...botafogoGame,
      status: 'live' as const,
      liveDetail: "67'",
      score: { home: 1, away: 0 },
    };
    const message = formatNextGame(live, broadcasts, now);
    expect(message).toContain('🔴 Botafogo em campo — Copa do Brasil');
    expect(message).toContain("⭐ Botafogo 1 x 0 Fluminense — 67'");
  });

  it.each([
    [{ type: 'today' as const }, ['2026-08-02']],
    [{ type: 'tomorrow' as const }, ['2026-08-03']],
    [{ type: 'weekday' as const, weekday: 6 }, ['2026-08-08']],
    [{ type: 'weekday' as const, weekday: 0 }, ['2026-08-02']],
    [{ type: 'date' as const, day: 31, month: 7 }, ['2026-07-31']],
    [{ type: 'date' as const, day: 5, month: 1 }, ['2027-01-05']],
  ])('resolve o período da agenda %o', (scope, dates) => {
    expect(resolveAgendaWindow(scope, now)?.dates).toEqual(dates);
  });

  it('resolve a semana em sete dias', () => {
    const window = resolveAgendaWindow({ type: 'week' }, now);
    expect(window?.dates).toHaveLength(7);
    expect(window?.dates.at(-1)).toBe('2026-08-08');
  });

  it('agrupa a agenda por competição e, na semana, por dia', () => {
    const today = formatAgenda([match({})], resolveAgendaWindow({ type: 'today' }, now)!, now);
    expect(today).toContain('🗓 Agenda para hoje (02/08):');
    expect(today).toContain('🏆 Brasileirão Série A\n• 18:30 — Flamengo x Santos');

    const week = formatAgenda(
      [match({}), botafogoGame],
      resolveAgendaWindow({ type: 'week' }, now)!,
      now,
    );
    expect(week).toContain('📅 Hoje, 02/08');
    expect(week).toContain('📅 Amanhã, 03/08\n🏆 Copa do Brasil\n⭐ 21:00 — Botafogo x Fluminense');

    expect(formatAgenda([], resolveAgendaWindow({ type: 'tomorrow' }, now)!, now)).toBe(
      'Nenhum jogo das competições acompanhadas encontrado para amanhã (03/08).',
    );
  });

  it('lista os próximos jogos do Botafogo com data e competição', () => {
    expect(formatBotafogoAgenda([botafogoGame], now)).toContain(
      '⭐ amanhã, 03/08 21:00 — Botafogo x Fluminense\n   🏆 Copa do Brasil',
    );
  });

  it('mostra o último resultado com os gols por time', () => {
    const message = formatResult(lastGame, lastReport);
    expect(message).toContain('🏁 Último jogo do Botafogo — Brasileirão Série A ✅ vitória');
    expect(message).toContain('⭐ Botafogo 2 x 1 Chapecoense');
    expect(message).toContain("⚽ Botafogo: Tiquinho 7', Savarino 88'");
    expect(message).toContain("⚽ Chapecoense: Perotti 40' (pênalti)");
  });

  it('usa a última escalação enquanto a próxima não sai', () => {
    const message = formatLineups({
      upcoming: botafogoGame,
      upcomingReport: null,
      last: lastGame,
      lastReport,
    });
    expect(message).toContain('A escalação de Botafogo x Fluminense ainda não saiu');
    expect(message).toContain('🔙 Última escalação (Botafogo 2 x 1 Chapecoense, 29/07)');
    expect(message).toContain('⭐ Botafogo (4-2-3-1):\nJogador 1, Jogador 2');

    const confirmed = formatLineups({
      upcoming: botafogoGame,
      upcomingReport: { ...lastReport, match: botafogoGame },
      last: null,
      lastReport: null,
    });
    expect(confirmed).toContain('📋 Escalações — Botafogo x Fluminense');
  });

  it('mostra a rodada atual e a tabela', () => {
    const round = formatRound(competition);
    expect(round).toContain('🏆 Brasileirão Série A — 20ª rodada');
    expect(round).toContain('⭐ 02/08 16:00 — Botafogo x Bahia');
    expect(round).toContain('• 02/08 16:00 — Palmeiras 2 x 0 Santos — encerrado');

    const table = formatBrasileiraoTable(competition);
    expect(table).toContain('🏆 Brasileirão Série A — 20ª rodada');
    expect(table).toContain('➡️ 3º Botafogo — 36 pts');
    expect(table).toContain('5º Santos');
  });

  it('mantém o tutorial em texto simples e com acentuação correta', () => {
    // Detecta UTF-8 decodificado duas vezes (ex.: "Ã£" no lugar de "ã"), sem barrar "BOLÃO".
    expect(tutorialMessage).not.toMatch(/Ã[\u0080-¿]|â€|âœ/u);
    expect(tutorialMessage).not.toMatch(/\*\*|##|`/);
    for (const command of ['!jogo', '!palpite', '!bolao', '!avisar', '!rodada', '!escalacao']) {
      expect(tutorialMessage).toContain(command);
    }
  });
});

describe('execução dos comandos', () => {
  const createComment = vi.fn().mockResolvedValue(99);
  const getUserFirstNames = vi.fn();
  const vk = { createComment, getUserFirstNames, groupId: 1 } as unknown as VkClient;
  const context = { topicId: 7, commentId: 12, userId: 2, topicTitle: 'Jogo', authorName: 'Bia' };
  const lastMessage = (): string => String(createComment.mock.calls.at(-1)?.[2]);

  beforeEach(() => {
    vi.clearAllMocks();
    alertMocks.list.mockResolvedValue([]);
  });

  it('!jogo consulta o próximo jogo e os canais', async () => {
    const football = fakeFootball();
    await executeCommand({ kind: 'game' }, context, { vk, football, now: () => now });

    expect(football.getBroadcasts).toHaveBeenCalledWith(botafogoGame);
    expect(createComment).toHaveBeenCalledWith(
      7,
      12,
      expect.stringContaining('[post12|Bia],\n⚽ Próximo jogo do Botafogo'),
      'topic:7:comment:12:reply:game',
    );
    expect(lastMessage()).toContain('Premiere 3');
  });

  it('responde na hora quando a fonte de jogos está fora do ar', async () => {
    const football = fakeFootball({
      getNextBotafogoMatch: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    await executeCommand({ kind: 'game' }, context, { vk, football, now: () => now });
    expect(lastMessage()).toBe(
      '[post12|Bia], ⚠️ não consegui consultar os dados de jogos agora. Tente novamente em alguns minutos.',
    );
  });

  it('não engole falhas da VK, que devem ser repetidas', async () => {
    const football = fakeFootball();
    createComment.mockRejectedValueOnce(new VkApiError('board.createComment', 6, 'rate'));
    await expect(
      executeCommand({ kind: 'game' }, context, { vk, football, now: () => now }),
    ).rejects.toThrow(VkApiError);
  });

  it('!agenda amanhã consulta só a data pedida', async () => {
    const football = fakeFootball();
    await executeCommand({ kind: 'agenda', scope: { type: 'tomorrow' } }, context, {
      vk,
      football,
      now: () => now,
    });
    expect(football.getAgendaMatches).toHaveBeenCalledWith(['2026-08-03']);
    expect(lastMessage()).toContain('Botafogo x Fluminense');
  });

  it('!resultado e !rodada usam as fontes certas', async () => {
    const football = fakeFootball();
    await executeCommand({ kind: 'result' }, context, { vk, football, now: () => now });
    expect(football.getMatchReport).toHaveBeenCalledWith('espn:3');
    expect(lastMessage()).toContain("Tiquinho 7'");

    await executeCommand({ kind: 'round' }, context, { vk, football, now: () => now });
    expect(lastMessage()).toContain('20ª rodada');
  });

  it('!camisa7 mostra a contagem formatada e a variação da semana', async () => {
    camisa7Mocks.trend.mockResolvedValue({ previousCount: 45_000, sinceDateKey: '2026-07-26' });
    await executeCommand({ kind: 'camisa7' }, context, {
      vk,
      football: fakeFootball(),
      getFanCount: () => Promise.resolve(45_120),
      now: () => now,
    });
    expect(camisa7Mocks.record).toHaveBeenCalledWith(45_120, now);
    expect(lastMessage()).toBe('[post12|Bia], Temos 45.120 sócios! ✈️\n📈 +120 desde 26/07');
  });

  it('!palpite registra e explica a pontuação', async () => {
    predictionMocks.register.mockResolvedValue({ status: 'registered', match: botafogoGame });
    await executeCommand({ kind: 'prediction', home: 2, away: 0 }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });
    expect(predictionMocks.register).toHaveBeenCalledWith(
      { userId: 2, topicId: 7, commentId: 12, home: 2, away: 0 },
      botafogoGame,
      now,
    );
    expect(lastMessage()).toContain('🎯 Palpite registrado: Botafogo 2 x 0 Fluminense.');
    expect(lastMessage()).toContain('Vale até o início do jogo (amanhã, 03/08 às 21:00)');
  });

  it('!palpite recusa depois do início do jogo', async () => {
    predictionMocks.register.mockResolvedValue({ status: 'closed', match: botafogoGame });
    await executeCommand({ kind: 'prediction', home: 1, away: 1 }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });
    expect(lastMessage()).toContain('estão encerrados');
  });

  it('!palpites lista todos os palpites do próximo jogo agrupados por placar', async () => {
    const open = (userId: string, homeGoals: number, awayGoals: number) => ({
      userId,
      homeGoals,
      awayGoals,
      status: 'open' as const,
    });
    predictionMocks.list.mockResolvedValue([
      open('10', 2, 0),
      open('11', 1, 1),
      open('12', 2, 0),
      open('13', 0, 1),
      { ...open('14', 3, 0), status: 'void' as const },
    ]);
    getUserFirstNames.mockResolvedValue(
      new Map([
        [10, 'Caio'],
        [11, 'Duda'],
        [12, 'Ana'],
        [13, 'Bia'],
        [14, 'Edu'],
      ]),
    );
    const football = fakeFootball();
    await executeCommand({ kind: 'prediction-list' }, context, { vk, football, now: () => now });

    expect(predictionMocks.list).toHaveBeenCalledWith('espn:2');
    expect(getUserFirstNames).toHaveBeenCalledOnce();
    expect(lastMessage()).toBe(
      [
        '[post12|Bia],',
        '🎯 Palpites para Botafogo x Fluminense',
        '⏳ Palpites abertos até amanhã, 03/08 às 21:00',
        '📊 4 palpite(s): Botafogo vence 2 · empate 1 · Fluminense vence 1',
        '',
        '• 2 x 0 (2): Ana e Caio',
        '• 1 x 1 (1): Duda',
        '• 0 x 1 (1): Bia',
        '',
        '💡 Mande ou mude o seu com !palpite 2x1 antes do jogo.',
      ].join('\n'),
    );
  });

  it('!palpites avisa quando ninguém palpitou e corta listas longas', async () => {
    predictionMocks.list.mockResolvedValue([]);
    getUserFirstNames.mockResolvedValue(new Map());
    await executeCommand({ kind: 'prediction-list' }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });
    expect(lastMessage()).toContain('Ninguém deu palpite ainda. Seja o primeiro: !palpite 2x1');

    // 21 x 21 placares distintos com vários palpiteiros cada estouram o limite da VK.
    predictionMocks.list.mockResolvedValue(
      Array.from({ length: 441 * 3 }, (_, index) => ({
        userId: String(index + 1),
        homeGoals: Math.floor(index / 3) % 21,
        awayGoals: Math.floor(index / 63),
        status: 'open' as const,
      })),
    );
    getUserFirstNames.mockResolvedValue(
      new Map(Array.from({ length: 441 * 3 }, (_, index) => [index + 1, `Torcedor${index + 1}`])),
    );
    await executeCommand({ kind: 'prediction-list' }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });
    expect(lastMessage().length).toBeLessThanOrEqual(3_600);
    expect(lastMessage()).toMatch(/\.\.\.e mais \d+ palpite\(s\) em outros placares\./u);
  });

  it('!bolao mostra o ranking com nomes em lote e a posição do autor', async () => {
    predictionMocks.ranking.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        userId: String(100 + index),
        points: 30 - index,
        exact: 2,
        predictions: 10,
      })).concat([{ userId: '2', points: 1, exact: 0, predictions: 3 }]),
    );
    getUserFirstNames.mockResolvedValue(new Map([[100, 'Ana']]));
    await executeCommand({ kind: 'prediction-ranking' }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });
    expect(getUserFirstNames).toHaveBeenCalledOnce();
    expect(lastMessage()).toContain('🥇 Ana — 30 pts (2 exato(s) em 10 palpite(s))');
    expect(lastMessage()).toContain('📌 Você: 13º lugar, 1 pts');
  });

  it('!avisar inscreve o autor no próximo jogo', async () => {
    alertMocks.subscribe.mockResolvedValue({ status: 'created', match: botafogoGame });
    await executeCommand({ kind: 'game-alert' }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });
    expect(lastMessage()).toContain(
      '🔔 combinado! Vou te marcar 30 min antes de Botafogo x Fluminense (amanhã, 03/08 às 21:00).',
    );
  });

  it('!lembretes lista lembretes e avisos de jogo', async () => {
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
    alertMocks.list.mockResolvedValue([
      { homeTeam: 'Botafogo', awayTeam: 'Fluminense', kickoffAt: new Date(botafogoGame.kickoffAt) },
    ]);

    await executeCommand({ kind: 'reminders' }, context, {
      vk,
      football: fakeFootball(),
      now: () => now,
    });

    expect(reminderMocks.find).toHaveBeenCalledWith(expect.objectContaining({ userId: '2' }));
    expect(lastMessage()).toContain('seus lembretes pendentes');
    expect(lastMessage()).toContain('1. 03/08, 12:00 — https://vk.com/topic-73670797_7?post=50');
    expect(lastMessage()).toContain('⚽ 03/08, 20:30 — aviso de Botafogo x Fluminense');
  });

  it('informa ano sem dados de atividade sem consultar o banco', async () => {
    await executeCommand({ kind: 'stats', year: 2025 }, context, { vk, now: () => now });
    expect(lastMessage()).toBe(
      '[post12|Bia],\n⚠️ Não há dados de atividade para 2025. A cobertura disponível começa em 2026 e vai até o ano atual.',
    );
  });
});
