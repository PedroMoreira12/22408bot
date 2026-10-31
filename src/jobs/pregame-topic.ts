import type { VkClient } from '../clients/vk.js';
import { formatPregameTopic, type SeasonRanking } from '../commands/bolao.js';
import { FIRST_BOLAO_YEAR, getPredictionRanking } from '../football/predictions.js';
import type { FootballService } from '../football/service.js';
import type { FootballMatch } from '../football/types.js';
import { log } from '../lib/logger.js';
import { localYear } from '../lib/time.js';
import { PregameTopic } from '../models/pregame-topic.js';
import { errorMessage } from './process-commands.js';
import { findOrAddTopic } from './vk-topics.js';

/** O tópico é aberto 24 horas antes do início do jogo. */
const LEAD_MILLISECONDS = 24 * 60 * 60_000;
/** Tão perto do início, um tópico novo já não serve para juntar palpites. */
const MINIMUM_LEAD_MILLISECONDS = 30 * 60_000;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MILLISECONDS = 10 * 60_000;
const CURRENT_SEASON_LEADERS = 10;
const PAST_SEASON_LEADERS = 3;

export interface PregameTopicStats {
  topics: number;
}

/**
 * Abre, 24 horas antes do próximo jogo do Botafogo, um tópico com as informações da partida, a
 * chamada para os palpites e o ranking do bolão de cada ano.
 */
export async function publishPregameTopic(
  vk: VkClient,
  football: FootballService,
  now = new Date(),
): Promise<PregameTopicStats> {
  const stats: PregameTopicStats = { topics: 0 };
  const match = await football.getNextBotafogoMatch(now);
  // Como no `!palpite`, só partidas da ESPN; sem horário confirmado não há como contar as 24 horas.
  if (!match?.id.startsWith('espn:') || match.status !== 'scheduled' || match.time === null) {
    return stats;
  }
  const kickoffAt = new Date(match.kickoffAt);
  const untilKickoff = kickoffAt.getTime() - now.getTime();
  if (untilKickoff > LEAD_MILLISECONDS || untilKickoff < MINIMUM_LEAD_MILLISECONDS) return stats;

  const matchId = match.id;
  const state = await PregameTopic.findOne({ matchId })
    .select({ attempts: 1, retryAt: 1, postedAt: 1 })
    .lean();
  if (state?.postedAt || (state?.attempts ?? 0) >= MAX_ATTEMPTS) return stats;
  if (state?.retryAt && state.retryAt > now) return stats;

  // A tentativa é registrada antes da escrita na VK; o lease global impede execuções paralelas.
  const attempt = (state?.attempts ?? 0) + 1;
  await PregameTopic.updateOne(
    { matchId },
    {
      $inc: { attempts: 1 },
      $set: {
        kickoffAt,
        retryAt: new Date(now.getTime() + RETRY_BASE_MILLISECONDS * 2 ** (attempt - 1)),
      },
    },
    { upsert: true },
  );
  try {
    const { topicId, title } = await createTopic(vk, football, match, now);
    await PregameTopic.updateOne(
      { matchId },
      { $set: { topicId: String(topicId), title, postedAt: now }, $unset: { lastError: 1 } },
    );
    stats.topics += 1;
  } catch (error) {
    await PregameTopic.updateOne({ matchId }, { $set: { lastError: errorMessage(error) } });
    log('warn', 'pregame_topic.failed', { matchId, attempt, error });
  }
  return stats;
}

async function createTopic(
  vk: VkClient,
  football: FootballService,
  match: FootballMatch,
  now: Date,
): Promise<{ topicId: number; title: string }> {
  // Do ano do jogo para trás: o ano atual com o top 10, os anteriores só com o pódio.
  const season = localYear(new Date(match.kickoffAt));
  const seasons = Array.from(
    { length: Math.max(season - FIRST_BOLAO_YEAR + 1, 1) },
    (_, index) => season - index,
  );
  const [broadcasts, rankings] = await Promise.all([
    football.getBroadcasts(match).catch(() => ({ broadcasts: [], source: null })),
    Promise.all(
      seasons.map(async (year, index): Promise<SeasonRanking> => ({
        season: year,
        leaders: (await getPredictionRanking(year)).slice(
          0,
          index === 0 ? CURRENT_SEASON_LEADERS : PAST_SEASON_LEADERS,
        ),
      })),
    ),
  ]);
  const names = await vk.getUserFirstNames(
    rankings.flatMap(({ leaders }) => leaders.map((entry) => Number(entry.userId))),
  );
  const { title, text } = formatPregameTopic(match, broadcasts, rankings, names, now);
  return { topicId: await findOrAddTopic(vk, title, text), title };
}
