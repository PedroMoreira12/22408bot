import { getCompetition } from 'campeonato-brasileiro-api';
import { z } from 'zod';

import { createCache } from './http.js';
import { HttpError, isTransientError } from './vk.js';
import { withRetry } from '../lib/retry.js';

const CACHE_MILLISECONDS = 5 * 60_000;

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

const teamSchema = z.object({
  id: nullableNumber,
  name: nullableString,
  shortName: nullableString,
});

const matchSchema = z.object({
  id: nullableNumber,
  round: nullableNumber,
  dateTime: nullableString,
  date: nullableString,
  time: nullableString,
  started: z.boolean(),
  status: z.enum(['scheduled', 'live', 'finished']),
  venue: nullableString,
  homeTeam: teamSchema,
  awayTeam: teamSchema,
  score: z.object({
    home: nullableNumber,
    away: nullableNumber,
  }),
});

const tableEntrySchema = z.object({
  position: nullableNumber,
  team: teamSchema,
  points: nullableNumber,
  matches: nullableNumber,
  wins: nullableNumber,
  draws: nullableNumber,
  losses: nullableNumber,
  goalsFor: nullableNumber,
  goalsAgainst: nullableNumber,
  goalDifference: nullableNumber,
});

const competitionSchema = z.object({
  competition: z.object({ name: z.string() }),
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      round: z.object({ number: nullableNumber, label: nullableString }),
      entries: z.array(tableEntrySchema),
    }),
  ),
  rounds: z.array(
    z.object({
      id: z.string(),
      number: nullableNumber,
      label: nullableString,
      matches: z.array(matchSchema),
    }),
  ),
});

export type BrasileiraoCompetition = z.infer<typeof competitionSchema>;
export type BrasileiraoMatch = z.infer<typeof matchSchema>;
export type BrasileiraoTableEntry = z.infer<typeof tableEntrySchema>;

const cache = createCache(CACHE_MILLISECONDS, loadCompetition);

/** Classificação e rodada atual da Série A. */
export async function getBrasileiraoCompetition(): Promise<BrasileiraoCompetition> {
  return cache.get();
}

async function loadCompetition(): Promise<BrasileiraoCompetition> {
  const payload = await getCompetition('a', { fetch: fetchWithRetry });
  const parsed = competitionSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Resposta inválida da fonte do Brasileirão');
  return parsed.data;
}

const fetchWithRetry: typeof fetch = async (input, init) =>
  withRetry(
    async () => {
      const headers = new Headers(init?.headers);
      headers.set('user-agent', 'pimpao-bot-vk/2.1');
      const response = await fetch(input, {
        ...init,
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new HttpError(response.status, 'Fonte do Brasileirão');
      return response;
    },
    { attempts: 3, baseDelayMs: 300, shouldRetry: isTransientError },
  );

export function resetBrasileiraoCacheForTests(): void {
  cache.clear();
}
