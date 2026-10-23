import { z } from 'zod';

import { createCache, fetchJson } from './http.js';
import { normalizeBroadcasts } from '../football/channels.js';
import type {
  FootballMatch,
  FootballTeam,
  MatchGoal,
  MatchReport,
  MatchStatus,
  TeamLineup,
} from '../football/types.js';
import { compareMatches } from '../football/types.js';
import { localDateKey, localTime } from '../lib/time.js';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LOCALE = 'lang=pt&region=br';
export const ESPN_BOTAFOGO_ID = '6086';

/** Competições acompanhadas pela agenda, com o nome exibido nas respostas. */
export const TRACKED_LEAGUES: Readonly<Record<string, string>> = {
  'bra.1': 'Brasileirão Série A',
  'bra.copa_do_brazil': 'Copa do Brasil',
  'conmebol.libertadores': 'Libertadores',
  'conmebol.sudamericana': 'Sul-Americana',
  'bra.camp.carioca': 'Carioca',
};

const VENUE_NAMES: Readonly<Record<string, string>> = {
  'Joao Havelange Stadium': 'Nilton Santos',
  'Estádio Olímpico João Havelange': 'Nilton Santos',
};

const PHASE_NAMES: Readonly<Record<string, string>> = {
  'group stage': 'Fase de grupos',
  'round of 32': 'Segunda fase',
  'round of 16': 'Oitavas de final',
  quarterfinals: 'Quartas de final',
  semifinals: 'Semifinal',
  final: 'Final',
  'first stage': 'Primeira fase',
  'second stage': 'Segunda fase',
  'third stage': 'Terceira fase',
  'first round': 'Primeira fase',
  'second round': 'Segunda fase',
  'third round': 'Terceira fase',
  'fourth round': 'Quarta fase',
  'fifth round': 'Quinta fase',
  playoffs: 'Playoffs',
  'knockout round playoffs': 'Playoffs',
};

const scoreSchema = z
  .union([
    z.string(),
    z.number(),
    z.object({ value: z.number().nullable().optional(), displayValue: z.string().optional() }),
  ])
  .nullable()
  .optional();

const teamSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

const competitorSchema = z.object({
  homeAway: z.enum(['home', 'away']),
  team: teamSchema,
  score: scoreSchema,
});

const statusSchema = z.object({
  displayClock: z.string().optional(),
  type: z.object({
    name: z.string(),
    state: z.enum(['pre', 'in', 'post']),
    completed: z.boolean(),
    detail: z.string().optional(),
    shortDetail: z.string().optional(),
  }),
});

const competitionSchema = z.object({
  id: z.string(),
  date: z.string(),
  timeValid: z.boolean().optional(),
  venue: z
    .object({
      fullName: z.string().optional(),
      address: z.object({ city: z.string().optional() }).optional(),
    })
    .nullable()
    .optional(),
  competitors: z.array(competitorSchema).min(2),
  status: statusSchema,
  notes: z
    .array(z.object({ type: z.string().optional(), headline: z.string().optional() }))
    .optional(),
  broadcasts: z.array(z.object({ names: z.array(z.string()).optional() })).optional(),
});

const eventSchema = z.object({
  id: z.string(),
  date: z.string(),
  timeValid: z.boolean().optional(),
  league: z.object({ slug: z.string(), name: z.string() }).optional(),
  seasonType: z.object({ name: z.string().optional() }).nullable().optional(),
  competitions: z.array(competitionSchema).min(1),
});

const eventListSchema = z.object({ events: z.array(eventSchema) });

const keyEventSchema = z.object({
  id: z.string(),
  type: z.object({ type: z.string().optional(), text: z.string().optional() }).optional(),
  scoringPlay: z.boolean().optional(),
  clock: z.object({ displayValue: z.string().optional() }).optional(),
  team: z.object({ id: z.string().optional(), displayName: z.string().optional() }).optional(),
  participants: z
    .array(z.object({ athlete: z.object({ displayName: z.string() }).optional() }))
    .optional(),
});

const rosterSchema = z.object({
  team: teamSchema,
  formation: z.string().nullable().optional(),
  roster: z
    .array(
      z.object({
        starter: z.boolean().optional(),
        athlete: z.object({ displayName: z.string() }),
      }),
    )
    .optional(),
});

const summarySchema = z.object({
  header: z.object({
    id: z.string(),
    league: z.object({ slug: z.string(), name: z.string() }).optional(),
    season: z.object({ name: z.string().optional() }).optional(),
    competitions: z.array(competitionSchema).min(1),
  }),
  keyEvents: z.array(keyEventSchema).optional(),
  rosters: z.array(rosterSchema).optional(),
  gameInfo: z
    .object({
      venue: z
        .object({
          fullName: z.string().optional(),
          address: z.object({ city: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

type EspnEvent = z.infer<typeof eventSchema>;
type EspnCompetition = z.infer<typeof competitionSchema>;

export interface EspnClientOptions {
  fetchImpl?: typeof fetch;
}

export class EspnClient {
  private readonly fixtures;
  private readonly season;
  private readonly months;
  private readonly summaries;

  constructor(private readonly options: EspnClientOptions = {}) {
    this.fixtures = createCache(5 * 60_000, () =>
      this.loadEvents(`${BASE_URL}/all/teams/${ESPN_BOTAFOGO_ID}/schedule?fixture=true&${LOCALE}`),
    );
    // Cache curto: a mesma lista indica um jogo em andamento quando ele sai dos próximos jogos.
    this.season = createCache(2 * 60_000, () =>
      this.loadEvents(`${BASE_URL}/all/teams/${ESPN_BOTAFOGO_ID}/schedule?${LOCALE}`),
    );
    this.months = createCache(10 * 60_000, (key) => {
      const [league, month] = key.split('|');
      return this.loadEvents(`${BASE_URL}/${league}/scoreboard?dates=${month}&${LOCALE}`, league);
    });
    this.summaries = createCache(50_000, (eventId) => this.loadSummary(eventId));
  }

  /** Jogos futuros ou em andamento do Botafogo em todas as competições, em ordem cronológica. */
  async getBotafogoFixtures(): Promise<FootballMatch[]> {
    return this.fixtures.get();
  }

  /** Jogos já encerrados do Botafogo na temporada, do mais recente para o mais antigo. */
  async getBotafogoResults(): Promise<FootballMatch[]> {
    const matches = await this.season.get();
    return matches.filter((match) => match.status === 'finished').reverse();
  }

  /** Jogos do Botafogo em andamento segundo a lista da temporada. */
  async getBotafogoLiveMatches(): Promise<FootballMatch[]> {
    const matches = await this.season.get();
    return matches.filter((match) => match.status === 'live');
  }

  /** Jogos de uma competição acompanhada em um mês (`AAAAMM`, em UTC). */
  async getLeagueMonth(league: string, month: string): Promise<FootballMatch[]> {
    return this.months.get(`${league}|${month}`);
  }

  async getMatchReport(matchId: string): Promise<MatchReport> {
    const eventId = matchId.replace(/^espn:/, '');
    if (!/^\d+$/.test(eventId)) throw new Error(`Jogo ESPN inválido: ${matchId}`);
    return this.summaries.get(eventId);
  }

  clearCache(): void {
    this.fixtures.clear();
    this.season.clear();
    this.months.clear();
    this.summaries.clear();
  }

  private async loadEvents(url: string, league?: string): Promise<FootballMatch[]> {
    const payload = await fetchJson(url, { context: 'ESPN', ...this.fetchOptions() });
    const parsed = eventListSchema.safeParse(payload);
    if (!parsed.success) throw new Error('Resposta inválida da ESPN');
    return parsed.data.events
      .flatMap((event) => {
        const match = toMatch(event, league);
        return match ? [match] : [];
      })
      .sort(compareMatches);
  }

  private async loadSummary(eventId: string): Promise<MatchReport> {
    const payload = await fetchJson(`${BASE_URL}/all/summary?event=${eventId}&${LOCALE}`, {
      context: 'ESPN',
      ...this.fetchOptions(),
    });
    return parseEspnSummary(payload);
  }

  private fetchOptions(): { fetchImpl?: typeof fetch } {
    return this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {};
  }
}

export function parseEspnSummary(payload: unknown): MatchReport {
  const parsed = summarySchema.safeParse(payload);
  if (!parsed.success) throw new Error('Resposta inválida do resumo da ESPN');
  const { header, keyEvents = [], rosters = [], gameInfo } = parsed.data;
  const competition = header.competitions[0];
  if (!competition) throw new Error('Resumo da ESPN sem partida');
  const venue = competition.venue ?? gameInfo?.venue ?? null;
  const match = toMatchFromCompetition(
    `espn:${header.id}`,
    { ...competition, venue },
    header.league?.slug,
    header.league?.name,
    header.season?.name,
  );
  if (!match) throw new Error('Resumo da ESPN sem mandante e visitante');

  const goals: MatchGoal[] = keyEvents
    .filter((event) => event.scoringPlay)
    .map((event) => {
      const type = `${event.type?.type ?? ''} ${event.type?.text ?? ''}`.toLowerCase();
      const teamName = event.team?.displayName ?? '';
      return {
        id: event.id,
        minute: event.clock?.displayValue ?? '',
        teamName,
        isBotafogo: event.team?.id === ESPN_BOTAFOGO_ID,
        scorer: event.participants?.[0]?.athlete?.displayName ?? null,
        penalty: type.includes('penalty') || type.includes('pênalti'),
        ownGoal: type.includes('own') || type.includes('contra'),
      };
    });

  const lineups: TeamLineup[] = rosters.map((roster) => ({
    teamName: roster.team.displayName,
    isBotafogo: roster.team.id === ESPN_BOTAFOGO_ID,
    formation: roster.formation ?? null,
    // A ESPN já lista os titulares do goleiro ao ataque.
    starters: (roster.roster ?? [])
      .filter((player) => player.starter)
      .map((player) => player.athlete.displayName),
  }));

  return { match, goals, lineups };
}

function toMatch(event: EspnEvent, league?: string): FootballMatch | null {
  const competition = event.competitions[0];
  if (!competition) return null;
  const slug = event.league?.slug ?? league;
  return toMatchFromCompetition(
    `espn:${event.id}`,
    { ...competition, timeValid: competition.timeValid ?? event.timeValid },
    slug,
    event.league?.name,
    event.seasonType?.name,
  );
}

function toMatchFromCompetition(
  id: string,
  competition: Omit<EspnCompetition, 'timeValid'> & { timeValid?: boolean | undefined },
  leagueSlug: string | undefined,
  leagueName: string | undefined,
  seasonTypeName: string | undefined,
): FootballMatch | null {
  const home = competition.competitors.find((item) => item.homeAway === 'home');
  const away = competition.competitors.find((item) => item.homeAway === 'away');
  if (!home || !away) return null;

  const kickoff = new Date(competition.date);
  if (Number.isNaN(kickoff.getTime())) return null;
  const status = toStatus(competition.status.type);
  const timeConfirmed = competition.timeValid !== false;
  const venueName = competition.venue?.fullName;
  const notes = (competition.notes ?? [])
    .filter((note) => note.type === 'event' && note.headline)
    .map((note) => note.headline?.split(' - ')[0]?.trim())
    .find((note) => note === 'Ida' || note === 'Volta');

  return {
    id,
    competition: (leagueSlug && TRACKED_LEAGUES[leagueSlug]) ?? leagueName ?? 'Futebol',
    phase: leagueSlug === 'bra.1' ? null : toPhase(seasonTypeName, notes),
    kickoffAt: kickoff.toISOString(),
    date: localDateKey(kickoff),
    time: timeConfirmed ? localTime(kickoff) : null,
    status,
    liveDetail:
      status === 'live'
        ? (competition.status.type.shortDetail ?? competition.status.displayClock ?? null)
        : null,
    venue: venueName ? (VENUE_NAMES[venueName] ?? venueName) : null,
    broadcasts: normalizeBroadcasts(
      (competition.broadcasts ?? []).flatMap((item) => item.names ?? []).map((name) => ({ name })),
    ),
    homeTeam: toTeam(home.team),
    awayTeam: toTeam(away.team),
    score:
      status === 'scheduled' || status === 'postponed'
        ? { home: null, away: null }
        : { home: toScore(home.score), away: toScore(away.score) },
  };
}

function toTeam(team: z.infer<typeof teamSchema>): FootballTeam {
  return {
    id: `espn:${team.id}`,
    name: team.displayName,
    isBotafogo: team.id === ESPN_BOTAFOGO_ID,
  };
}

function toStatus(type: EspnCompetition['status']['type']): MatchStatus {
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|ABANDONED|DELAYED/.test(type.name)) {
    return 'postponed';
  }
  if (type.state === 'in') return 'live';
  if (type.state === 'post') return type.completed ? 'finished' : 'postponed';
  return 'scheduled';
}

function toScore(score: z.infer<typeof scoreSchema>): number | null {
  if (score === null || score === undefined) return null;
  if (typeof score === 'number') return score;
  if (typeof score === 'string') return /^\d+$/.test(score) ? Number(score) : null;
  if (typeof score.value === 'number') return score.value;
  return score.displayValue && /^\d+$/.test(score.displayValue) ? Number(score.displayValue) : null;
}

function toPhase(seasonTypeName: string | undefined, leg: string | undefined): string | null {
  const raw = seasonTypeName?.trim();
  if (!raw && !leg) return null;
  const phase = raw ? (PHASE_NAMES[raw.toLowerCase()] ?? raw) : null;
  const legLabel = leg ? `jogo de ${leg.toLowerCase()}` : null;
  return [phase, legLabel].filter(Boolean).join(' — ') || null;
}
