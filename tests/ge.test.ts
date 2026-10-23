import { describe, expect, it } from 'vitest';

import { parseGeDailyScheduleHtml, parseGeTeamScheduleHtml } from '../src/clients/ge.js';

const rawMatch = (id: number, competition: string, date = '2026-08-03') => ({
  id,
  moment: 'FUTURE',
  phase: { championshipEdition: { championship: { name: competition } }, name: 'Oitavas' },
  round: null,
  scoreboard: { home: null, away: null, penalty: null },
  firstContestant: { id: 263, name: 'Botafogo de Futebol e Regatas', popularName: 'Botafogo' },
  secondContestant: { id: 266, name: 'Fluminense Football Club', popularName: 'Fluminense' },
  startDate: date,
  startHour: '21:00:00',
  location: { popularName: 'Nilton Santos' },
  liveWatchSources: [
    { name: 'Premiere' },
    { name: 'sportv' },
    { name: 'Premiere' },
    { name: 'Cartola' },
  ],
});

describe('parser da agenda pública do ge', () => {
  it('extrai a agenda do Botafogo e remove itens que não são transmissões', () => {
    const payload = { matches: [rawMatch(1, 'Copa do Brasil')], team: { id: 263 } };
    const html = `<script>window.byTeamScheduleTeamData = ${JSON.stringify(payload)}; window.x = [];</script>`;

    expect(parseGeTeamScheduleHtml(html)).toEqual([
      expect.objectContaining({
        id: 'ge:1',
        competition: 'Copa do Brasil',
        date: '2026-08-03',
        time: '21:00',
        kickoffAt: '2026-08-04T00:00:00.000Z',
        venue: 'Nilton Santos',
        broadcasts: [
          { name: 'Premiere', kind: 'pay-tv' },
          { name: 'sportv', kind: 'pay-tv' },
        ],
        homeTeam: { id: 'ge:263', name: 'Botafogo', isBotafogo: true },
      }),
    ]);
  });

  it('mantém apenas as cinco competições acompanhadas na agenda geral', () => {
    const championship = (name: string, id: number) => ({
      championship: { name },
      future: [{ match: rawMatch(id, name) }],
      now: [],
      past: [],
    });
    const payload = {
      '2026-08-03': {
        championshipsAgenda: [
          championship('Campeonato Brasileiro', 1),
          championship('Copa do Brasil', 2),
          championship('Taça Conmebol Libertadores', 3),
          championship('Copa Sul-Americana', 4),
          championship('Campeonato Carioca', 5),
          championship('Campeonato Brasileiro Feminino', 6),
          championship('Premier League', 7),
        ],
      },
    };
    const html = `<script>window.dataSportsSchedule = {\n    sport: ${JSON.stringify(payload)} };</script>`;

    const names = parseGeDailyScheduleHtml(html).map((match) => match.competition);
    expect(names).toEqual([
      'Brasileirão Série A',
      'Copa do Brasil',
      'Libertadores',
      'Sul-Americana',
      'Carioca',
    ]);
  });

  it('falha de forma explícita quando a página muda de estrutura', () => {
    expect(() => parseGeTeamScheduleHtml('<html></html>')).toThrow(
      'Dados da agenda não encontrados',
    );
  });
});
