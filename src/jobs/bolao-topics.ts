import type { VkClient } from '../clients/vk.js';
import { formatBolaoResultTopic } from '../commands/bolao.js';
import { getPredictionRanking, listMatchPredictions } from '../football/predictions.js';
import type { FootballService } from '../football/service.js';
import { log } from '../lib/logger.js';
import { localYear } from '../lib/time.js';
import { BolaoTopic } from '../models/bolao-topic.js';
import { Prediction } from '../models/prediction.js';
import { errorMessage } from './process-commands.js';

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MILLISECONDS = 10 * 60_000;
/** Só anuncia jogos conferidos há pouco, para que um deploy não publique jogos antigos. */
const SETTLED_LOOKBACK_MILLISECONDS = 12 * 60 * 60_000;
/** Limita a busca pelo índice `{ status, kickoffAt }`. */
const KICKOFF_LOOKBACK_MILLISECONDS = 7 * 86_400_000;
const RANKING_PREVIEW_SIZE = 5;
/** Tópicos fixados vêm sempre primeiro no `board.getTopics`, mesmo ordenando por criação. */
const DUPLICATE_CHECK_TOPICS = 50;

export interface BolaoTopicStats {
  topics: number;
}

/**
 * Cria um tópico com o resultado do bolão de cada jogo conferido que teve palpites válidos.
 * Jogos sem palpites, ou só com palpites anulados, não geram tópico.
 */
export async function publishBolaoTopics(
  vk: VkClient,
  football: FootballService,
  deadline: number,
  now = new Date(),
  maxTopics = 1,
): Promise<BolaoTopicStats> {
  const stats: BolaoTopicStats = { topics: 0 };
  const settled = await Prediction.aggregate<{ _id: string; kickoffAt: Date }>([
    {
      $match: {
        status: 'settled',
        kickoffAt: { $gte: new Date(now.getTime() - KICKOFF_LOOKBACK_MILLISECONDS) },
        settledAt: { $gte: new Date(now.getTime() - SETTLED_LOOKBACK_MILLISECONDS) },
      },
    },
    { $group: { _id: '$matchId', kickoffAt: { $min: '$kickoffAt' } } },
    { $sort: { kickoffAt: 1 } },
  ]);
  if (settled.length === 0) return stats;

  const states = await BolaoTopic.find({ matchId: { $in: settled.map((match) => match._id) } })
    .select({ matchId: 1, attempts: 1, retryAt: 1, postedAt: 1 })
    .lean();
  const stateByMatch = new Map(states.map((state) => [state.matchId, state]));

  for (const { _id: matchId, kickoffAt } of settled) {
    if (stats.topics >= maxTopics || Date.now() >= deadline) break;
    const state = stateByMatch.get(matchId);
    if (state?.postedAt || (state?.attempts ?? 0) >= MAX_ATTEMPTS) continue;
    if (state?.retryAt && state.retryAt > now) continue;

    // A tentativa é registrada antes da escrita na VK; o lease global impede execuções paralelas.
    const attempt = (state?.attempts ?? 0) + 1;
    await BolaoTopic.updateOne(
      { matchId },
      {
        $inc: { attempts: 1 },
        $set: { retryAt: new Date(now.getTime() + RETRY_BASE_MILLISECONDS * 2 ** (attempt - 1)) },
        $setOnInsert: { kickoffAt },
      },
      { upsert: true },
    );
    try {
      const { topicId, title } = await createTopic(vk, football, matchId);
      await BolaoTopic.updateOne(
        { matchId },
        { $set: { topicId: String(topicId), title, postedAt: now }, $unset: { lastError: 1 } },
      );
      stats.topics += 1;
    } catch (error) {
      await BolaoTopic.updateOne({ matchId }, { $set: { lastError: errorMessage(error) } });
      log('warn', 'bolao_topic.failed', { matchId, attempt, error });
    }
  }
  return stats;
}

async function createTopic(
  vk: VkClient,
  football: FootballService,
  matchId: string,
): Promise<{ topicId: number; title: string }> {
  const report = await football.getMatchReport(matchId);
  const { match } = report ?? {};
  if (!report || match?.status !== 'finished') {
    throw new Error(`Resultado final de ${matchId} indisponível`);
  }

  const season = localYear(new Date(report.match.kickoffAt));
  const [predictions, ranking] = await Promise.all([
    listMatchPredictions(matchId),
    getPredictionRanking(season),
  ]);
  const leaders = ranking.slice(0, RANKING_PREVIEW_SIZE);
  const names = await vk.getUserFirstNames(
    [...predictions, ...leaders].map((entry) => Number(entry.userId)),
  );
  const { title, text } = formatBolaoResultTopic(report, predictions, leaders, names, season);

  // Uma tentativa anterior pode ter criado o tópico sem conseguir registrar o sucesso.
  const recent = await vk.getTopics(0, DUPLICATE_CHECK_TOPICS, 2);
  const existing = recent.items.find((topic) => normalizeTitle(topic.title) === title);
  if (existing) return { topicId: existing.id, title };
  return { topicId: await vk.addTopic(title, text), title };
}

/** A VK devolve títulos com entidades HTML para alguns caracteres. */
function normalizeTitle(title: string): string {
  return title
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .trim();
}
