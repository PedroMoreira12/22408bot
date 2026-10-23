import { describe, expect, it, vi } from 'vitest';

import { EspnClient, parseEspnSummary } from '../src/clients/espn.js';
import { espnEvent, summaryPayload } from './fixtures/espn.js';

function requestedUrl(fetchImpl: { mock: { calls: Array<Parameters<typeof fetch>> } }): string {
  const input = fetchImpl.mock.calls[0]?.[0];
  if (input === undefined) return '';
  return input instanceof Request ? input.url : input.toString();
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

describe('EspnClient', () => {
  it('converte o calendário do Botafogo com horário local e horário a definir', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        events: [
          espnEvent({
            id: '2',
            date: '2026-11-18T20:00Z',
            home: ['874', 'Corinthians'],
            away: ['6086', 'Botafogo'],
            league: { slug: 'bra.1', name: 'Campeonato Brasileiro' },
            timeValid: false,
          }),
          espnEvent({
            id: '1',
            date: '2026-10-24T19:30Z',
            home: ['1936', 'Internacional'],
            away: ['6086', 'Botafogo'],
            league: { slug: 'bra.1', name: 'Campeonato Brasileiro' },
            venue: 'Estadio Beira-Rio',
          }),
        ],
      }),
    );
    const client = new EspnClient({ fetchImpl });

    const matches = await client.getBotafogoFixtures();

    expect(requestedUrl(fetchImpl)).toContain('/all/teams/6086/schedule?fixture=true');
    expect(matches.map((match) => match.id)).toEqual(['espn:1', 'espn:2']);
    expect(matches[0]).toMatchObject({
      competition: 'Brasileirão Série A',
      date: '2026-10-24',
      time: '16:30',
      status: 'scheduled',
      venue: 'Estadio Beira-Rio',
      score: { home: null, away: null },
      awayTeam: { id: 'espn:6086', name: 'Botafogo', isBotafogo: true },
    });
    expect(matches[1]).toMatchObject({ date: '2026-11-18', time: null });
  });

  it('traduz fases de copa e identifica jogo de ida ou volta', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        events: [
          espnEvent({
            id: '9',
            date: '2026-03-11T00:30Z',
            home: ['6086', 'Botafogo'],
            away: ['1', 'Barcelona SC'],
            league: { slug: 'conmebol.libertadores', name: 'CONMEBOL Libertadores' },
            seasonType: 'Third Stage',
            notes: [{ type: 'event', headline: 'Volta - Barcelona SC avança 2-1 no agregado' }],
            state: 'post',
            score: [
              { value: 0, displayValue: '0' },
              { value: 1, displayValue: '1' },
            ],
          }),
        ],
      }),
    );
    const [match] = await new EspnClient({ fetchImpl }).getBotafogoResults();

    expect(match).toMatchObject({
      competition: 'Libertadores',
      phase: 'Terceira fase — jogo de volta',
      status: 'finished',
      score: { home: 0, away: 1 },
    });
  });

  it('busca agenda por mês e competição', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ events: [] }));
    await new EspnClient({ fetchImpl }).getLeagueMonth('bra.copa_do_brazil', '202610');
    expect(requestedUrl(fetchImpl)).toContain('/bra.copa_do_brazil/scoreboard?dates=202610');
  });

  it('falha de forma explícita com resposta inesperada', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ nada: true }));
    await expect(new EspnClient({ fetchImpl }).getBotafogoFixtures()).rejects.toThrow(
      'Resposta inválida da ESPN',
    );
  });
});

describe('parseEspnSummary', () => {
  it('extrai placar, gols e escalações', () => {
    const report = parseEspnSummary(summaryPayload);

    expect(report.match).toMatchObject({
      id: 'espn:401841268',
      status: 'finished',
      venue: 'Nilton Santos',
      score: { home: 2, away: 1 },
    });
    expect(report.goals).toEqual([
      expect.objectContaining({ id: '53830225', scorer: 'Tiquinho Soares', isBotafogo: true }),
      expect.objectContaining({ id: '53830300', teamName: 'Chapecoense', penalty: true }),
      expect.objectContaining({ id: '53830400', minute: "88'" }),
    ]);
    expect(report.lineups[0]).toMatchObject({ teamName: 'Botafogo', formation: '4-2-3-1' });
    expect(report.lineups[0]?.starters).toHaveLength(11);
    expect(report.lineups[0]?.starters).not.toContain('Reserva');
  });
});
