import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/models/match-discussion.js', () => ({ MatchDiscussion: db }));
import type { VkClient, VkComment } from '../src/clients/vk.js';
import type { FootballService } from '../src/football/service.js';
import type { FootballMatch, MatchReport } from '../src/football/types.js';
import { sheetFixture, type OfficialMatchSheet } from '../src/football/match-sheet.js';
import {
  ESPN_LINEUP_HEADING,
  LINEUP_HEADING,
  OPPONENT_LINEUP_HEADING,
} from '../src/football/discussion.js';
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
  opponentStarters: [],
};
const players = Array.from({ length: 11 }, (_, i) => `Jogador ${i + 1}`);
const rivalPlayers = players.map((p) => 'Rival ' + p);
const espnTeam = {
  teamId: 'espn:6086',
  teamName: 'Botafogo',
  isBotafogo: true,
  formation: null,
  starters: players,
};
const espnRival = {
  teamId: 'espn:2026',
  teamName: 'São Paulo',
  isBotafogo: false,
  formation: null,
  starters: rivalPlayers,
};
const espnUrl = 'https://www.espn.com.br/futebol/partida/_/jogoId/401841326';
const espnReport: MatchReport = {
  match: {
    ...match,
    id: 'espn:401841326',
    homeTeam: { ...match.homeTeam, id: espnTeam.teamId },
    awayTeam: { ...match.awayTeam, id: espnRival.teamId },
  },
  goals: [],
  lineups: [espnRival, espnTeam],
};
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
const opening: VkComment = {
  id: 441,
  from_id: 64,
  date: now.getTime() / 1000,
  can_edit: 1,
  text: '📋 Ficha Técnica\nTransmissão atualizada pela torcida.\nhttps://www.cbf.com.br/jogo',
};
let visibleOpening: VkComment;
const vk = {
  groupId: 42,
  getTopics: vi.fn(),
  addTopic: vi.fn(),
  createComment: vi.fn<VkClient['createComment']>(),
  editOwnComment: vi.fn<VkClient['editOwnComment']>(),
  getComments: vi.fn(),
};
const football = {
  getDiscussionMatch: vi.fn(),
  getOfficialMatchSheet: vi.fn(),
  getMatchReport: vi.fn(),
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
  visibleOpening = { ...opening };
  vk.getComments.mockImplementation(() => Promise.resolve({ count: 1, items: [visibleOpening] }));
  vk.editOwnComment.mockImplementation((_topicId, comment, text) => {
    visibleOpening = { ...comment, text };
    return Promise.resolve(true);
  });
  football.getDiscussionMatch.mockResolvedValue(match);
  football.getOfficialMatchSheet.mockResolvedValue(sheet);
  football.getMatchReport.mockResolvedValue(null);
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

  it('inclui os onze de cada equipe já confirmados e registra as duas escalações na abertura', async () => {
    football.getOfficialMatchSheet.mockResolvedValue({
      ...sheet,
      starters: players,
      opponentStarters: rivalPlayers,
    });
    await run();
    expect(vk.addTopic).toHaveBeenCalledWith(
      title,
      expect.stringContaining(LINEUP_HEADING + ' (CBF):'),
    );
    expect(db.updateOne).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          lineupPostedAt: expect.any(Date),
          opponentLineupPostedAt: expect.any(Date),
        }),
      }),
    );
    expect(vk.createComment).not.toHaveBeenCalled();
    expect(football.getMatchReport).not.toHaveBeenCalled();
    expect(vk.addTopic.mock.calls[0]?.[1]).toContain(OPPONENT_LINEUP_HEADING + 'São Paulo (CBF):');
  });

  it('inclui os titulares identificados pela ESPN na abertura quando a ficha da CBF está vazia', async () => {
    football.getMatchReport.mockResolvedValue(espnReport);
    await run();
    const body = String(vk.addTopic.mock.calls[0]?.[1]);
    expect(body).toContain(ESPN_LINEUP_HEADING);
    expect(body).toContain('Jogador 10 e Jogador 11.');
    expect(body.split(espnUrl)).toHaveLength(2);
    expect(body).toContain('Ficha oficial (CBF):');
    expect(body).toContain(OPPONENT_LINEUP_HEADING + 'São Paulo (ESPN):\nRival Jogador 1,');
    expect(body).toContain('Rival Jogador 10 e Rival Jogador 11.');
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: expect.objectContaining({
        topicId: 1234,
        lineupPostedAt: expect.any(Date),
        opponentLineupPostedAt: expect.any(Date),
      }),
    });
  });

  it('abre o tópico na hora mesmo se a consulta à ESPN demorar', async () => {
    vi.useFakeTimers();
    try {
      football.getMatchReport.mockImplementation(() => new Promise(() => {}));
      const publishing = run();
      await vi.advanceTimersByTimeAsync(4000);
      await expect(publishing).resolves.toEqual({ topics: 1, lineups: 0 });
      expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
        $set: { topicId: 1234, retryAt: expect.any(Date) },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reserva o tempo de criação do tópico se faltar pouco para o início', async () => {
    await expect(run(new Date(kickoff.getTime() - 2000))).resolves.toEqual({
      topics: 1,
      lineups: 0,
    });
    expect(football.getMatchReport).not.toHaveBeenCalled();
  });

  it.each([sheet, null])(
    'recupera os titulares da ESPN no tópico pendente pela ficha salva',
    async (official) => {
      db.findOne.mockReturnValueOnce(query({ ...recorded, topicId: 987 }));
      football.getDiscussionMatch.mockResolvedValue(null);
      football.getOfficialMatchSheet.mockResolvedValue(official);
      football.getMatchReport.mockResolvedValue(espnReport);
      await expect(run(kickoff)).resolves.toEqual({ topics: 0, lineups: 2 });
      expect(football.getMatchReport).toHaveBeenCalledWith(match.id, ref);
      expect(vk.editOwnComment).toHaveBeenCalledWith(
        987,
        opening,
        expect.stringContaining(opening.text + '\n\n' + ESPN_LINEUP_HEADING),
      );
      expect(vk.createComment).not.toHaveBeenCalled();
      expect(db.updateOne).toHaveBeenLastCalledWith(
        { groupId: 42, matchId: match.id },
        {
          $set: { lineupPostedAt: expect.any(Date), opponentLineupPostedAt: expect.any(Date) },
        },
      );
    },
  );

  it('mantém a pendência até receber exatamente onze titulares distintos do Botafogo', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987, opponentLineupPostedAt: now }));
    football.getDiscussionMatch.mockResolvedValue(null);
    for (const lineups of [
      [espnReport.lineups[0]],
      [espnTeam, espnTeam],
      [{ ...espnTeam, starters: players.slice(1) }],
      [{ ...espnTeam, starters: [...players, 'Reserva'] }],
      [{ ...espnTeam, starters: [...players.slice(1), ' jógador 2 '] }],
      [{ ...espnTeam, starters: [...players.slice(1), ' '] }],
    ]) {
      football.getMatchReport.mockResolvedValueOnce({ ...espnReport, lineups });
      await run();
    }
    football.getMatchReport.mockRejectedValueOnce(new Error('HTTP 503'));
    await run();
    football.getOfficialMatchSheet.mockResolvedValueOnce({ ...sheet, kickoffAt: null });
    football.getMatchReport.mockResolvedValue(espnReport);
    await run();
    expect(vk.createComment).not.toHaveBeenCalled();
    expect(vk.editOwnComment).not.toHaveBeenCalled();
    expect(db.updateOne).not.toHaveBeenCalled();
    await run();
    expect(vk.editOwnComment).toHaveBeenCalledTimes(1);
  });

  it('completa o A/D/D anterior ao deploy só com o São Paulo e recupera uma gravação perdida', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987, lineupPostedAt: now }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getMatchReport.mockResolvedValue(espnReport);
    const previous = [
      opening.text,
      ESPN_LINEUP_HEADING + ':\n' + players.join(', ') + '.',
      espnUrl,
    ].join('\n');
    visibleOpening = { ...opening, text: previous };
    db.updateOne.mockRejectedValueOnce(new Error('mongo indisponível depois da edição'));
    await run();
    await run();
    expect(db.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          {
            $or: [
              { lineupPostedAt: { $exists: false } },
              { opponentLineupPostedAt: { $exists: false } },
            ],
          },
        ]),
      }),
    );
    expect(visibleOpening.text).toBe(
      previous +
        '\n\n' +
        OPPONENT_LINEUP_HEADING +
        'São Paulo (ESPN):\n' +
        rivalPlayers.slice(0, -1).join(', ') +
        ' e Rival Jogador 11.',
    );
    expect(vk.editOwnComment).toHaveBeenCalledOnce();
    expect(vk.addTopic).not.toHaveBeenCalled();
    expect(vk.createComment).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { opponentLineupPostedAt: expect.any(Date) },
    });
  });

  it('inclui o adversário quando ele sai primeiro e edita só com os onze do Botafogo depois', async () => {
    football.getOfficialMatchSheet.mockResolvedValueOnce({
      ...sheet,
      opponentStarters: rivalPlayers,
    });
    football.getMatchReport.mockRejectedValueOnce(new Error('ESPN indisponível'));
    await run();
    const first = String(vk.addTopic.mock.calls[0]?.[1]);
    expect(first).toContain(OPPONENT_LINEUP_HEADING + 'São Paulo (CBF):\nRival Jogador 1,');
    expect(first).not.toContain(LINEUP_HEADING);
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { topicId: 1234, retryAt: expect.any(Date), opponentLineupPostedAt: expect.any(Date) },
    });
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 1234, opponentLineupPostedAt: now }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getMatchReport.mockResolvedValue(espnReport);
    visibleOpening = { ...opening, text: first };
    await expect(run(kickoff)).resolves.toEqual({ topics: 0, lineups: 1 });
    expect(visibleOpening.text.startsWith(first + '\n\n' + ESPN_LINEUP_HEADING)).toBe(true);
    expect(visibleOpening.text.split(OPPONENT_LINEUP_HEADING)).toHaveLength(2);
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { lineupPostedAt: expect.any(Date) },
    });
  });

  it('usa o ID do mandante da ESPN para o adversário e mantém a ficha oficial do Botafogo visitante', async () => {
    football.getDiscussionMatch.mockResolvedValue({
      ...match,
      homeTeam: match.awayTeam,
      awayTeam: match.homeTeam,
    });
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    football.getMatchReport.mockResolvedValue({
      ...espnReport,
      match: {
        ...espnReport.match,
        homeTeam: espnReport.match.awayTeam,
        awayTeam: espnReport.match.homeTeam,
      },
      lineups: [{ ...espnTeam, starters: players.map((p) => 'Outro ' + p) }, espnRival],
    });
    await run();
    const body = String(vk.addTopic.mock.calls[0]?.[1]);
    expect(body).toContain(LINEUP_HEADING + ' (CBF):\nJogador 1,');
    expect(body).toContain(OPPONENT_LINEUP_HEADING + 'São Paulo (ESPN):\nRival Jogador 1,');
    expect(body).not.toContain('Outro Jogador');
  });

  it('aguarda se a lista adversária vier incompleta, repetida, ambígua ou de outro clube', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987, lineupPostedAt: now }));
    football.getDiscussionMatch.mockResolvedValue(null);
    for (const lineups of [
      [espnRival, espnRival],
      [{ ...espnRival, teamId: 'espn:99' }],
      [{ ...espnRival, starters: rivalPlayers.slice(1) }],
      [{ ...espnRival, starters: [...rivalPlayers.slice(1), rivalPlayers[1]] }],
    ]) {
      football.getMatchReport.mockResolvedValueOnce({ ...espnReport, lineups });
      await run();
    }
    expect(vk.editOwnComment).not.toHaveBeenCalled();
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('a releitura de uma abertura só com Botafogo não confirma a edição do adversário', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987, lineupPostedAt: now }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getMatchReport.mockResolvedValue(espnReport);
    visibleOpening = { ...opening, text: opening.text + '\n\n' + ESPN_LINEUP_HEADING };
    vk.editOwnComment.mockResolvedValueOnce(true);
    await run();
    expect(db.updateOne).not.toHaveBeenCalled();
    await expect(run()).resolves.toEqual({ topics: 0, lineups: 1 });
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { opponentLineupPostedAt: expect.any(Date) },
    });
  });

  it('reconhece a escalação ESPN do Botafogo na recuperação e continua procurando a do adversário', async () => {
    db.findOne.mockReturnValueOnce(query(recorded));
    football.getDiscussionMatch.mockResolvedValue(null);
    vk.getTopics.mockResolvedValue({
      items: [
        {
          id: 987,
          title,
          created: now.getTime() / 1000,
          first_comment: ESPN_LINEUP_HEADING + ':\n' + players.join(', '),
        },
      ],
    });
    await run(kickoff);
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { topicId: 987, lineupPostedAt: expect.any(Date) },
    });
    expect(football.getMatchReport).toHaveBeenCalledWith(match.id, ref);
    expect(vk.createComment).not.toHaveBeenCalled();
  });

  it('acrescenta os 11 ao fim do texto atual da abertura, mesmo se a agenda já mostrar outro jogo', async () => {
    db.findOne.mockReturnValueOnce(query({ ...recorded, topicId: 987 }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    await expect(run(new Date(kickoff.getTime() + 60_000))).resolves.toEqual({
      topics: 0,
      lineups: 1,
    });
    expect(football.getOfficialMatchSheet).toHaveBeenCalledWith(ref);
    expect(vk.getComments).toHaveBeenCalledWith(987, 0, 1, 'asc');
    expect(vk.getComments).toHaveBeenCalledTimes(2);
    expect(vk.editOwnComment).toHaveBeenCalledWith(
      987,
      opening,
      expect.stringContaining(opening.text + '\n\n' + LINEUP_HEADING),
    );
    expect(visibleOpening.text.endsWith('Jogador 10 e Jogador 11.')).toBe(true);
    expect(vk.createComment).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenCalledWith(
      { groupId: 42, matchId: match.id },
      { $set: { lineupPostedAt: expect.any(Date) } },
    );
    expect(vk.addTopic).not.toHaveBeenCalled();
  });

  it('relê o texto depois de uma falha transitória e preserva as alterações feitas entre tentativas', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987 }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet
      .mockResolvedValueOnce({ ...sheet, starters: players.slice(0, 10) })
      .mockResolvedValue({ ...sheet, starters: players });
    vk.editOwnComment.mockRejectedValueOnce(new Error('timeout'));
    await run();
    await run();
    expect(db.updateOne).not.toHaveBeenCalled();
    visibleOpening = { ...opening, text: opening.text + '\nAtualização do autor.' };
    await run();
    expect(visibleOpening.text).toContain('Atualização do autor.\n\n' + LINEUP_HEADING);
    expect(vk.editOwnComment).toHaveBeenCalledTimes(2);
    expect(vk.createComment).not.toHaveBeenCalled();
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

  it('reconhece a edição aplicada mesmo que a resposta se perca', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987 }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    vk.editOwnComment.mockImplementationOnce((_topic, comment, text) => {
      visibleOpening = { ...comment, text };
      return Promise.reject(new Error('timeout'));
    });
    await run();
    expect(db.updateOne).not.toHaveBeenCalled();
    await expect(run()).resolves.toEqual({ topics: 0, lineups: 0 });
    expect(vk.editOwnComment).toHaveBeenCalledTimes(1);
    expect(vk.createComment).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { lineupPostedAt: expect.any(Date) },
    });
  });

  it('aguarda a abertura e a confirmação na releitura antes de concluir a escalação', async () => {
    db.findOne.mockReturnValue(query({ ...recorded, topicId: 987 }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    vk.getComments.mockResolvedValueOnce({ items: [] });
    await run();
    expect(vk.editOwnComment).not.toHaveBeenCalled();
    vk.getComments
      .mockResolvedValueOnce({ items: [opening] })
      .mockResolvedValueOnce({ items: [opening] });
    await run();
    expect(db.updateOne).not.toHaveBeenCalled();
    await run();
    expect(vk.editOwnComment).toHaveBeenCalledTimes(1);
    expect(vk.createComment).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenCalledOnce();
  });

  it('mantém o comentário avulso com o mesmo guid se a abertura não puder ser editada', async () => {
    const pending = { ...recorded, topicId: 987 };
    db.findOne
      .mockReturnValueOnce(query(pending))
      .mockReturnValue(query({ ...pending, lineupAsComment: true }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getOfficialMatchSheet.mockResolvedValue({ ...sheet, starters: players });
    vk.editOwnComment.mockResolvedValueOnce(false);
    vk.createComment.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(123);
    await run();
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { lineupAsComment: true },
    });
    await expect(run()).resolves.toEqual({ topics: 0, lineups: 1 });
    expect(vk.editOwnComment).toHaveBeenCalledOnce();
    expect(vk.createComment.mock.calls.map((args) => args[3])).toEqual([
      'discussion:42:987:lineup',
      'discussion:42:987:lineup',
    ]);
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { lineupPostedAt: expect.any(Date) },
    });
  });

  it('retoma só o comentário avulso do adversário com guid próprio após uma falha parcial', async () => {
    const pending = { ...recorded, topicId: 987, lineupAsComment: true };
    db.findOne
      .mockReturnValueOnce(query(pending))
      .mockReturnValueOnce(query({ ...pending, lineupPostedAt: now }));
    football.getDiscussionMatch.mockResolvedValue(null);
    football.getMatchReport.mockResolvedValue(espnReport);
    vk.createComment
      .mockResolvedValueOnce(100)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(101);
    await expect(run()).resolves.toEqual({ topics: 0, lineups: 1 });
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { lineupPostedAt: now },
    });
    await expect(run()).resolves.toEqual({ topics: 0, lineups: 1 });
    expect(vk.editOwnComment).not.toHaveBeenCalled();
    expect(vk.createComment.mock.calls.map((args) => args[3])).toEqual([
      'discussion:42:987:lineup',
      'discussion:42:987:opponent-lineup',
      'discussion:42:987:opponent-lineup',
    ]);
    expect(vk.createComment.mock.calls[2]?.[2]).toContain(espnUrl);
    expect(db.updateOne).toHaveBeenLastCalledWith(expect.anything(), {
      $set: { opponentLineupPostedAt: now },
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
    expect(vk.editOwnComment).toHaveBeenCalledWith(700, opening, expect.any(String));
    expect(vk.createComment).not.toHaveBeenCalled();
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
