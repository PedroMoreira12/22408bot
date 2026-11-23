import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/models/match-discussion.js', () => ({ MatchDiscussion: db }));
import type { VkClient } from '../src/clients/vk.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch } from '../src/football/types.js';
import { sheetFixture, type OfficialMatchSheet } from '../src/football/match-sheet.js';
import { LINEUP_HEADING } from '../src/football/discussion.js';
import { publishMatchDiscussion } from '../src/jobs/match-discussion.js';

const now = new Date('2026-11-23T22:00:00Z');
const kickoff = new Date('2026-11-23T23:00:00Z');
const match: FootballMatch = {
  id: 'cbf:832242',
  competition: 'Brasileirão Série A',
  phase: '36ª rodada',
  date: '2026-11-23',
  time: '20:00',
  kickoffAt: kickoff.toISOString(),
  status: 'scheduled',
  liveDetail: null,
  venue: 'Nilton Santos',
  broadcasts: [],
  homeTeam: { id: 'cbf:60175', name: 'Botafogo', isBotafogo: true },
  awayTeam: { id: 'cbf:20005', name: 'São Paulo', isBotafogo: false },
  score: { home: null, away: null },
};
const title = 'A/D/D | Botafogo × São Paulo | Brasileirão – 36ª rodada';
const ref = sheetFixture(match)!;
const sheet: OfficialMatchSheet = {
  source: 'CBF',
  url: 'https://www.cbf.com.br/jogo',
  kickoffAt: kickoff,
  phase: match.phase,
  venue: 'Estádio Nilton Santos, Rio de Janeiro (RJ)',
  broadcasts: [{ name: 'Prime Video', kind: 'paid-streaming' }],
  referee: 'Andre Luiz Skettino Policarpo Bento (MG)',
  starters: [],
};
const players = Array.from({ length: 11 }, (_, i) => `Jogador ${i + 1}`);
const recorded = {
  groupId: 42,
  matchId: match.id,
  fixtureKey: '2026-11-23|Brasileirão Série A|true|sao paulo',
  fixture: ref,
  kickoffAt: kickoff,
  title,
  attempts: 1,
  retryAt: now,
};
const vk = {
  groupId: 42,
  getTopics: vi.fn(),
  addTopic: vi.fn(),
  createComment: vi.fn<VkClient['createComment']>(),
  getComments: vi.fn(),
};
const football = {
  getDiscussionMatch: vi.fn(),
  getOfficialMatchSheet: vi.fn(),
  getBroadcasts: vi.fn(),
  getRecentBotafogoResults: vi.fn(),
};
const run = (time = now) =>
  publishMatchDiscussion(
    vk as unknown as VkClient,
    football as unknown as FootballService,
    Date.now() + 45_000,
    time,
  );
const query = (value: unknown) => {
  const lean = () => Promise.resolve(value);
  return { lean, sort: () => ({ lean }) };
};

beforeEach(() => {
  vi.resetAllMocks();
  db.findOne.mockReturnValue(query(null));
  db.updateOne.mockResolvedValue({ acknowledged: true });
  vk.getTopics.mockResolvedValue({ items: [] });
  vk.addTopic.mockResolvedValue(1234);
  football.getDiscussionMatch.mockResolvedValue(match);
  football.getOfficialMatchSheet.mockResolvedValue(sheet);
  football.getBroadcasts.mockResolvedValue({ broadcasts: [], source: null });
});

describe('A/D/D', () => {
  it('abre às 19h para o jogo das 20h com a ficha oficial e sem depender da escalação', async () => {
    await expect(run()).resolves.toEqual({ topics: 1, lineups: 0 });
    const body = String(vk.addTopic.mock.calls[0]?.[1]);
    expect(vk.addTopic).toHaveBeenCalledWith(title, expect.any(String));
    for (const line of [
      '📋 Ficha Técnica',
      '🏆 Jogo: Botafogo × São Paulo',
      'Hoje (23/11/2026), às 20h (horário de Brasília)',
      'Estádio Nilton Santos, Rio de Janeiro (RJ)',
      'Transmissão: Prime Video',
      'Arbitragem: Andre Luiz Skettino Policarpo Bento (MG)',
    ])
      expect(body).toContain(line);
    expect(body).not.toContain(LINEUP_HEADING);
    expect(football.getBroadcasts).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenLastCalledWith(
      { groupId: 42, matchId: match.id },
      { $set: { topicId: 1234, retryAt: expect.any(Date) } },
    );
    expect(football.getRecentBotafogoResults).not.toHaveBeenCalled();
  });

  it('inclui os onze já confirmados na abertura e registra que não há comentário pendente', async () => {
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    await run();
    expect(vk.addTopic).toHaveBeenCalledWith(
      title,
      expect.stringContaining(LINEUP_HEADING + ' (CBF):'),
    );
    expect(db.updateOne).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ lineupPostedAt: expect.any(Date) }),
      }),
    );
    expect(vk.createComment).not.toHaveBeenCalled();
  });

  it('depois da abertura publica os 11 no mesmo tópico, mesmo se a agenda já mostrar outro jogo', async () => {
    db.findOne.mockReturnValueOnce(query({ ...recorded, topicId: 987 }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    await expect(run(new Date(kickoff.getTime() + 60_000))).resolves.toEqual({
      topics: 0,
      lineups: 1,
    });
    expect(football.getOfficialMatchSheet).toHaveBeenCalledWith(ref);
    expect(vk.createComment).toHaveBeenCalledWith(
      987,
      null,
      expect.stringContaining('Jogador 10 e Jogador 11.'),
      'discussion:42:987:lineup',
    );
    expect(db.updateOne).toHaveBeenCalledWith(
      { groupId: 42, matchId: match.id },
      { $set: { lineupPostedAt: expect.any(Date) } },
    );
    expect(vk.addTopic).not.toHaveBeenCalled();
  });

  it('mantém a escalação pendente se for parcial ou se o envio falhar e reutiliza o guid na retomada', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987 }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet
      .mockResolvedValueOnce({ ...sheet, starters: players.slice(0, 10) })
      .mockResolvedValue({ ...sheet, starters: players });
    vk.createComment.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(22);
    await run();
    await run();
    expect(db.updateOne).not.toHaveBeenCalled();
    await run();
    expect(vk.createComment.mock.calls.map((args) => args[3])).toEqual([
      'discussion:42:987:lineup',
      'discussion:42:987:lineup',
    ]);
    expect(db.updateOne).toHaveBeenCalledTimes(1);
  });

  it('recupera um A/D/D manual recente ou criado antes de um timeout, lendo a abertura real', async () => {
    vk.getTopics.mockResolvedValue({
      items: [
        { id: 6, title, created: now.getTime() / 1000 - 7 * 86400, first_comment: LINEUP_HEADING },
        {
          id: 7,
          title: 'A/D/D | Botafogo x São Paulo',
          created: now.getTime() / 1000,
          first_comment: '📋 Ficha Técnica',
        },
      ],
    });
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    await run();
    expect(vk.addTopic).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { topicId: 7, retryAt: expect.any(Date) },
    });
    vk.getTopics.mockResolvedValue({
      items: [
        {
          id: 7,
          title,
          created: now.getTime() / 1000,
          first_comment: LINEUP_HEADING + ' (CBF): ' + players.join(', '),
        },
      ],
    });
    await run();
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: expect.objectContaining({ topicId: 7, lineupPostedAt: expect.any(Date) }),
    });
  });

  it('se a VK gravou e o banco falhou no último minuto, reconcilia após o início sem recriar', async () => {
    const state = { ...recorded };
    db.findOne.mockReturnValueOnce(query(state));
    football.getDiscussionMatch.mockResolvedValue(null);
    vk.getTopics.mockResolvedValue({
      items: [{ id: 700, title, created: now.getTime() / 1000, first_comment: '📋 Ficha Técnica' }],
    });
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    await run(kickoff);
    expect(vk.addTopic).not.toHaveBeenCalled();
    expect(vk.createComment).toHaveBeenCalledWith(
      700,
      null,
      expect.any(String),
      'discussion:42:700:lineup',
    );
  });

  it('rejeita jogo adiado, sem horário, fora da janela ou com remarcação na ficha oficial', async () => {
    await run(new Date(now.getTime() - 1));
    await run(kickoff);
    for (const overrides of [{ status: 'postponed' }, { status: 'live' }, { time: null }]) {
      football.getDiscussionMatch.mockResolvedValueOnce({ ...match, ...overrides });
      await run();
    }
    football.getOfficialMatchSheet
      .mockResolvedValueOnce({ ...sheet, kickoffAt: null })
      .mockResolvedValueOnce({ ...sheet, kickoffAt: new Date(kickoff.getTime() + 60 * 60_000) });
    await run();
    await run();
    expect(vk.addTopic).not.toHaveBeenCalled();
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('aguarda o backoff e não reabre um A/D/D já registrado sob o ID da outra agenda', async () => {
    db.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query({ ...recorded, retryAt: new Date(kickoff) }));
    await run();
    db.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query({ ...recorded, matchId: 'ge:42', topicId: 99 }));
    await run();
    expect(vk.addTopic).not.toHaveBeenCalled();
    expect(football.getOfficialMatchSheet).not.toHaveBeenCalled();
    expect(db.findOne).toHaveBeenCalledWith({
      groupId: 42,
      $or: [{ matchId: match.id }, { fixtureKey: recorded.fixtureKey }],
    });
  });

  it('abre também em outras competições e marca campos indisponíveis; transmite a fonte de TV brasileira', async () => {
    football.getDiscussionMatch.mockResolvedValue({
      ...match,
      competition: 'Amistoso',
      phase: null,
    });
    football.getOfficialMatchSheet.mockResolvedValue(null);
    football.getBroadcasts
      .mockResolvedValueOnce({
        broadcasts: [{ name: 'sportv', kind: 'pay-tv' }],
        source: 'futebolnatv',
      })
      .mockRejectedValueOnce(new Error('offline'));
    await run();
    await run();
    const first = String(vk.addTopic.mock.calls[0]?.[1]);
    expect(first).toContain('Arbitragem: A confirmar');
    expect(first).toContain('Fonte dos canais: futebolnatv.com.br');
    expect(vk.addTopic.mock.calls[1]?.[1]).toContain('Transmissão: A confirmar');
  });
});
