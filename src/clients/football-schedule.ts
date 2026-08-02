import { z } from 'zod';

import { HttpError, isTransientError } from './vk.js';
import { withRetry } from '../lib/retry.js';

const TEAM_SCHEDULE_URL =
  'https://ge.globo.com/futebol/times/botafogo/agenda-de-jogos-do-botafogo/';
const DAILY_SCHEDULE_URL = 'https://ge.globo.com/agenda/';
const CACHE_MILLISECONDS = 5 * 60_000;

const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  popularName: z.string(),
});

const liveWatchSourceSchema = z.object({
  name: z.string(),
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
  liveWatchSources: z.array(liveWatchSourceSchema).nullable().optional(),
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

export interface FootballTeam {
  id: number;
  name: string;
  popularName: string;
}

export interface FootballMatch {
  id: number;
  competition: string;
  phase: string | null;
  round: number | null;
  date: string;
  time: string | null;
  status: 'scheduled' | 'live' | 'finished';
  venue: string | null;
  broadcasts: string[];
  homeTeam: FootballTeam;
  awayTeam: FootballTeam;
  score: { home: number | null; away: number | null };
}

export interface FootballSchedule {
  matches: FootballMatch[];
}

interface CacheEntry {
  expiresAt: number;
  value: FootballSchedule;
}

let teamCache: CacheEntry | undefined;
let dailyCache: CacheEntry | undefined;
let pendingTeamRequest: Promise<FootballSchedule> | undefined;
let pendingDailyRequest: Promise<FootballSchedule> | undefined;

export async function getBotafogoSchedule(): Promise<FootballSchedule> {
  const now = Date.now();
  if (teamCache && teamCache.expiresAt > now) return teamCache.value;
  pendingTeamRequest ??= loadTeamSchedule();

  try {
    const value = await pendingTeamRequest;
    teamCache = { value, expiresAt: Date.now() + CACHE_MILLISECONDS };
    return value;
  } finally {
    pendingTeamRequest = undefined;
  }
}

export async function getDailyFootballSchedule(): Promise<FootballSchedule> {
  const now = Date.now();
  if (dailyCache && dailyCache.expiresAt > now) return dailyCache.value;
  pendingDailyRequest ??= loadDailySchedule();

  try {
    const value = await pendingDailyRequest;
    dailyCache = { value, expiresAt: Date.now() + CACHE_MILLISECONDS };
    return value;
  } finally {
    pendingDailyRequest = undefined;
  }
}

async function loadTeamSchedule(): Promise<FootballSchedule> {
  const html = await fetchHtml(TEAM_SCHEDULE_URL, 'Agenda do Botafogo');
  return parseGeTeamScheduleHtml(html);
}

async function loadDailySchedule(): Promise<FootballSchedule> {
  const html = await fetchHtml(DAILY_SCHEDULE_URL, 'Agenda de jogos');
  return parseGeDailyScheduleHtml(html);
}

async function fetchHtml(url: string, context: string): Promise<string> {
  return withRetry(
    async () => {
      const response = await fetch(url, {
        headers: { 'user-agent': 'pimpao-bot-vk/2.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new HttpError(response.status, context);
      return response.text();
    },
    { attempts: 3, baseDelayMs: 300, shouldRetry: isTransientError },
  );
}

export function parseGeTeamScheduleHtml(html: string): FootballSchedule {
  const payload = extractJsonValue(html, 'window.byTeamScheduleTeamData =');
  const parsed = teamPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Resposta inválida da agenda do Botafogo');
  return { matches: parsed.data.matches.map((match) => toMatch(match)) };
}

export function parseGeDailyScheduleHtml(html: string): FootballSchedule {
  const assignment = /window\.dataSportsSchedule\s*=\s*\{\s*sport\s*:/.exec(html);
  if (!assignment || assignment.index === undefined) {
    throw new Error('Dados da agenda não encontrados');
  }
  const payload = extractJsonAt(html, assignment.index + assignment[0].length);
  const parsed = dailyPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Resposta inválida da agenda de jogos');

  const matches = Object.values(parsed.data).flatMap((day) =>
    day.championshipsAgenda.flatMap((agenda) => {
      if (!isSupportedCompetition(agenda.championship.name)) return [];
      return [...agenda.now, ...agenda.future, ...agenda.past].map((event) =>
        toMatch(event.match, agenda.championship.name),
      );
    }),
  );
  return { matches: deduplicateMatches(matches) };
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
  return {
    id: raw.id,
    competition: competition ?? raw.phase.championshipEdition.championship.name,
    phase: raw.phase.name ?? null,
    round: raw.round ?? null,
    date: raw.startDate,
    time: raw.startHour?.slice(0, 5) ?? null,
    status: raw.moment === 'FUTURE' ? 'scheduled' : raw.moment === 'NOW' ? 'live' : 'finished',
    venue: raw.location?.popularName ?? null,
    broadcasts: [
      ...new Set((raw.liveWatchSources ?? []).map((source) => source.name.trim()).filter(Boolean)),
    ],
    homeTeam: raw.firstContestant,
    awayTeam: raw.secondContestant,
    score: { home: raw.scoreboard.home, away: raw.scoreboard.away },
  };
}

function isSupportedCompetition(name: string): boolean {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return new Set([
    'campeonato brasileiro',
    'copa do brasil',
    'taca conmebol libertadores',
    'copa sul-americana',
    'campeonato carioca',
  ]).has(normalized);
}

function deduplicateMatches(matches: FootballMatch[]): FootballMatch[] {
  return [...new Map(matches.map((match) => [match.id, match])).values()];
}

export function resetFootballScheduleCacheForTests(): void {
  teamCache = undefined;
  dailyCache = undefined;
  pendingTeamRequest = undefined;
  pendingDailyRequest = undefined;
}
