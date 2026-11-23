import { z } from 'zod';

import { createCache, fetchJson } from './http.js';
import { normalizeBroadcasts } from '../football/channels.js';
import {
  clubKey,
  normalizedName,
  startingEleven,
  type OfficialMatchSheet,
  type SheetFixture,
} from '../football/match-sheet.js';
import { log } from '../lib/logger.js';
import { formatDateKey, saoPauloDate } from '../lib/time.js';
import type { FootballMatch } from '../football/types.js';

const SITE = 'https://www.cbf.com.br';
const BOTAFOGO_ID = '60175';
const competitions: Record<string, { name: string; category: string; path: string }> = {
  'Brasileirão Série A': {
    name: 'Campeonato Brasileiro',
    category: 'Série A',
    path: 'campeonato-brasileiro/serie-a',
  },
  'Copa do Brasil': {
    name: 'Copa do Brasil',
    category: 'Profissional',
    path: 'copa-do-brasil/profissional',
  },
};

const id = z.coerce.string().regex(/^\d+$/u);
const flag = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);
const team = z.object({ id, nome: z.string(), gols: z.string().or(z.number()).nullish() });
const calendarGame = z.object({
  id_jogo: id,
  mandante: team,
  visitante: team,
  data: z.string().trim(),
  hora: z.string().nullish(),
  local: z.string().nullish(),
  rodada: id.nullish(),
  transmissoes: z.array(z.object({ nome: z.string() })).nullish(),
});
const calendar = z.object({
  jogos: z.union([
    z.record(z.string(), z.record(z.string(), z.unknown())),
    z.array(z.never()).length(0),
  ]),
});
const player = z.object({
  id,
  reserva: flag,
  nome: z.string().nullish(),
  apelido: z.string().nullish(),
});
const teamSheet = team.extend({ atletas: z.array(player).nullish() });
const matchDetails = z.object({
  jogo: calendarGame.extend({
    mandante: teamSheet,
    visitante: teamSheet,
    etapa: z.string().nullish(),
    canais: z.string().nullish(),
    arbitros: z
      .array(z.object({ funcao: z.string(), nome: z.string(), uf: z.string().nullish() }))
      .nullish(),
  }),
});

/** Os dois recursos JSON alimentam, respectivamente, o calendário e a ficha pública da CBF. */
export class CbfClient {
  private readonly days;
  private readonly games;

  constructor(fetchImpl: typeof fetch = fetch) {
    const options = { context: 'CBF', fetchImpl, attempts: 1, timeoutMs: 3000 };
    this.days = createCache(
      5 * 60_000,
      async (date) =>
        calendar.parse(
          await fetchJson(`${SITE}/api/cbf/calendario/jogos/${date.replaceAll('-', '/')}`, options),
        ).jogos,
    );
    this.games = createCache(
      45_000,
      async (gameId) =>
        matchDetails.parse(await fetchJson(`${SITE}/api/cbf/jogos/${gameId}`, options)).jogo,
    );
  }

  async getBotafogoMatches(date: string): Promise<FootballMatch[]> {
    const day = await this.days.get(date);
    if (Array.isArray(day)) return [];
    return Object.entries(competitions).flatMap(([name, competition]) => {
      const games = z
        .array(calendarGame)
        .parse(day[competition.name]?.[competition.category] ?? []);
      return games
        .filter(
          (game) =>
            game.data === formatDateKey(date) &&
            game.mandante.gols == null &&
            game.visitante.gols == null &&
            [game.mandante.id, game.visitante.id].includes(BOTAFOGO_ID),
        )
        .map((game): FootballMatch => {
          const time = confirmedTime(game.hora);
          const toTeam = (side: typeof game.mandante) => ({
            id: `cbf:${side.id}`,
            name: side.nome,
            isBotafogo: side.id === BOTAFOGO_ID,
          });
          return {
            id: `cbf:${game.id_jogo}`,
            competition: name,
            phase: name === 'Brasileirão Série A' && game.rodada ? `${game.rodada}ª rodada` : null,
            homeTeam: toTeam(game.mandante),
            awayTeam: toTeam(game.visitante),
            date,
            time,
            kickoffAt: saoPauloDate(date, time ?? '00:00').toISOString(),
            status: 'scheduled',
            liveDetail: null,
            venue: formatVenue(game.local),
            broadcasts: normalizeBroadcasts(
              (game.transmissoes ?? []).map(({ nome }) => ({ name: nome })),
            ),
            score: { home: null, away: null },
          };
        });
    });
  }

  async getSheet(fixture: SheetFixture): Promise<OfficialMatchSheet | null> {
    const competition = competitions[fixture.competition];
    if (!competition) return null;
    const day = await this.days.get(fixture.date);
    if (Array.isArray(day)) return null;
    const entries = z
      .array(calendarGame)
      .parse(day[competition.name]?.[competition.category] ?? []);
    const matches = entries.filter((game) => {
      const [bot, other] = fixture.botafogoHome
        ? [game.mandante, game.visitante]
        : [game.visitante, game.mandante];
      return (
        game.data === formatDateKey(fixture.date) &&
        bot.id === BOTAFOGO_ID &&
        clubKey(other.nome) === clubKey(fixture.botafogoHome ? fixture.away : fixture.home)
      );
    });
    const game = matches[0];
    if (!game || matches.length !== 1) return null;

    // Se só o detalhe cair, o calendário ainda confirma o horário, o local e os canais.
    const details = await this.games.get(game.id_jogo).catch((error: unknown) => {
      log('warn', 'cbf.match_failed', { gameId: game.id_jogo, error });
      return null;
    });
    if (
      details &&
      (details.id_jogo !== game.id_jogo ||
        details.mandante.id !== game.mandante.id ||
        details.visitante.id !== game.visitante.id)
    ) {
      throw new Error('Identidade da ficha da CBF diverge do calendário');
    }

    const current = details ?? game;
    const [dd, mm, yyyy] = current.data.split('/');
    const time = confirmedTime(current.hora);
    const kickoffAt =
      time && /^\d{2}\/\d{2}\/\d{4}$/u.test(current.data)
        ? saoPauloDate(`${yyyy}-${mm}-${dd}`, time)
        : null;
    const principal = details?.arbitros?.find(
      (entry) => normalizedName(entry.funcao) === 'arbitro',
    );
    const players = (fixture.botafogoHome ? details?.mandante : details?.visitante)?.atletas ?? [];
    const starters = players.filter((athlete) => !athlete.reserva);
    const labels = details?.canais?.trim()
      ? details.canais.split(/\s*,\s*/u).map((name) => ({ name }))
      : (game.transmissoes ?? []).map(({ nome }) => ({ name: nome }));
    const slug = (name: string) =>
      normalizedName(name)
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
    return {
      source: 'CBF',
      url: `${SITE}/futebol-brasileiro/jogos/${competition.path}/${yyyy}/${slug(game.mandante.nome)}-x-${slug(game.visitante.nome)}/${game.id_jogo}`,
      kickoffAt,
      venue: formatVenue(current.local ?? game.local),
      phase:
        fixture.competition === 'Brasileirão Série A' && current.rodada
          ? `${current.rodada}ª rodada`
          : (details?.etapa ?? null),
      broadcasts: normalizeBroadcasts(labels),
      referee: principal?.nome.trim()
        ? `${principal.nome.trim()}${principal.uf ? ` (${principal.uf})` : ''}`
        : null,
      starters:
        new Set(starters.map((athlete) => athlete.id)).size === 11
          ? startingEleven(
              starters.map((athlete) =>
                (athlete.apelido?.trim() || athlete.nome || '').replace(/^\d+\s*-\s*/u, ''),
              ),
            )
          : [],
    };
  }
}

function confirmedTime(raw: string | null | undefined): string | null {
  const time = raw?.trim();
  return time && /^([01]\d|2[0-3]):[0-5]\d$/u.test(time) ? time : null;
}

function formatVenue(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const parts = /^(.*) - (.+) - ([A-Z]{2})$/u.exec(raw.trim());
  if (!parts) return raw.trim();
  const stadium = parts[1] === 'Nilton Santos' ? 'Estádio Nilton Santos' : parts[1];
  return `${stadium}, ${parts[2]} (${parts[3]})`;
}
