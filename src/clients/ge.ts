import { z } from 'zod';

import { createCache, fetchText } from './http.js';
import { normalizeBroadcasts } from '../football/channels.js';
import type { FootballMatch, FootballTeam } from '../football/types.js';
import { compareMatches } from '../football/types.js';
import { saoPauloDate } from '../lib/time.js';

const TEAM_SCHEDULE_URL =
  'https://ge.globo.com/futebol/times/botafogo/agenda-de-jogos-do-botafogo/';
const DAILY_SCHEDULE_URL = 'https://ge.globo.com/agenda/';
const CACHE_MILLISECONDS = 5 * 60_000;
const GE_BOTAFOGO_ID = 263;

const COMPETITION_NAMES: Readonly<Record<string, string>> = {
  'campeonato brasileiro': 'Brasileirão Série A',
  'copa do brasil': 'Copa do Brasil',
  'taca conmebol libertadores': 'Libertadores',
  'copa sul-americana': 'Sul-Americana',
  'campeonato carioca': 'Carioca',
};

const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  popularName: z.string(),
});

const rawMatchSchema = z.object({
  id: z.number(),
  moment: z.enum(['FUTURE', 'NOW', 'PAST']),
  phase: z.object({
    championshipEdition: z.object({
      championship: z.object({ name: z.string() }),
    }),
    name: z.string().nullable().optional(),
  }),
  round: z.number().nullable().optional(),
  scoreboard: z.object({
    home: z.number().nullable(),
    away: z.number().nullable(),
    penalty: z.unknown().nullable().optional(),
  }),
  firstContestant: teamSchema,
  secondContestant: teamSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.string().nullable(),
  location: z.object({ popularName: z.string().nullable() }).nullable().optional(),
  liveWatchSources: z
    .array(z.object({ name: z.string() }))
    .nullable()
    .optional(),
});

const teamPayloadSchema = z.object({ matches: z.array(rawMatchSchema) });
const eventSchema = z.object({ match: rawMatchSchema });
const championshipAgendaSchema = z.object({
  championship: z.object({ name: z.string() }),
  future: z.array(eventSchema),
  now: z.array(eventSchema),
  past: z.array(eventSchema),
});
const dailyPayloadSchema = z.record(
  z.string(),
  z.object({ championshipsAgenda: z.array(championshipAgendaSchema) }),
);

export interface GeClientOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Fonte reserva: páginas públicas de agenda do ge. A página do clube traz apenas o próximo jogo,
 * e os canais informados se limitam a parte das emissoras.
 */
export class GeClient {
  private readonly team;
  private readonly daily;

  constructor(private readonly options: GeClientOptions = {}) {
    this.team = createCache(CACHE_MILLISECONDS, async () =>
      parseGeTeamScheduleHtml(await this.fetchPage(TEAM_SCHEDULE_URL, 'Agenda do Botafogo')),
    );
    this.daily = createCache(CACHE_MILLISECONDS, async () =>
      parseGeDailyScheduleHtml(await this.fetchPage(DAILY_SCHEDULE_URL, 'Agenda de jogos')),
    );
  }

  async getBotafogoMatches(): Promise<FootballMatch[]> {
    return this.team.get();
  }

  /** Jogos das competições acompanhadas entre anteontem e depois de amanhã. */
  async getDailyMatches(): Promise<FootballMatch[]> {
    return this.daily.get();
  }

  clearCache(): void {
    this.team.clear();
    this.daily.clear();
  }

  private async fetchPage(url: string, context: string): Promise<string> {
    return fetchText(url, {
      context,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
  }
}

export function parseGeTeamScheduleHtml(html: string): FootballMatch[] {
  const payload = extractJsonValue(html, 'window.byTeamScheduleTeamData =');
  const parsed = teamPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Resposta inválida da agenda do Botafogo');
  return parsed.data.matches.map((match) => toMatch(match)).sort(compareMatches);
}

export function parseGeDailyScheduleHtml(html: string): FootballMatch[] {
  const assignment = /window\.dataSportsSchedule\s*=\s*\{\s*sport\s*:/.exec(html);
  if (!assignment) throw new Error('Dados da agenda não encontrados');
  const payload = extractJsonAt(html, assignment.index + assignment[0].length);
  const parsed = dailyPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Resposta inválida da agenda de jogos');

  const matches = Object.values(parsed.data).flatMap((day) =>
    day.championshipsAgenda.flatMap((agenda) => {
      const competition = competitionName(agenda.championship.name);
      if (!competition) return [];
      return [...agenda.now, ...agenda.future, ...agenda.past].map((event) =>
        toMatch(event.match, competition),
      );
    }),
  );
  return [...new Map(matches.map((match) => [match.id, match])).values()].sort(compareMatches);
}

function extractJsonValue(html: string, marker: string): unknown {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error('Dados da agenda não encontrados');

  return extractJsonAt(html, markerIndex + marker.length);
}

function extractJsonAt(html: string, valueIndex: number): unknown {
  let start = valueIndex;
  while (/\s/.test(html[start] ?? '')) start += 1;
  const opening = html[start];
  if (opening !== '{' && opening !== '[') throw new Error('Formato da agenda não reconhecido');

  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, index + 1)) as unknown;
    }
  }
  throw new Error('Dados incompletos na agenda');
}

function toMatch(raw: z.infer<typeof rawMatchSchema>, competition?: string): FootballMatch {
  const time = raw.startHour?.slice(0, 5) ?? null;
  const championship = raw.phase.championshipEdition.championship.name;
  return {
    id: `ge:${raw.id}`,
    competition: competition ?? competitionName(championship) ?? championship,
    phase: raw.phase.name ?? null,
    kickoffAt: saoPauloDate(raw.startDate, time ?? '00:00').toISOString(),
    date: raw.startDate,
    time,
    status: raw.moment === 'FUTURE' ? 'scheduled' : raw.moment === 'NOW' ? 'live' : 'finished',
    liveDetail: null,
    venue: raw.location?.popularName ?? null,
    broadcasts: normalizeBroadcasts(raw.liveWatchSources ?? []),
    homeTeam: toTeam(raw.firstContestant),
    awayTeam: toTeam(raw.secondContestant),
    score: { home: raw.scoreboard.home, away: raw.scoreboard.away },
  };
}

function toTeam(team: z.infer<typeof teamSchema>): FootballTeam {
  return { id: `ge:${team.id}`, name: team.popularName, isBotafogo: team.id === GE_BOTAFOGO_ID };
}

function competitionName(name: string): string | undefined {
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return COMPETITION_NAMES[normalized];
}
