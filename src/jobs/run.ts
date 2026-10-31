import { randomUUID } from 'node:crypto';

import { VkClient } from '../clients/vk.js';
import { getConfig } from '../config.js';
import { connectDatabase } from '../db.js';
import { settlePredictions } from '../football/predictions.js';
import { getFootballService } from '../football/service.js';
import { log } from '../lib/logger.js';
import { runActivityBackfill, type ActivityBackfillStats } from './backfill-activity.js';
import { publishBolaoTopics, type BolaoTopicStats } from './bolao-topics.js';
import { ensureDailyCamisa7Snapshot } from './camisa7-snapshot.js';
import { acquireJobLease, releaseJobLease } from './lease.js';
import { postBolaoSummaries, runMatchFeed } from './match-feed.js';
import { pollVkDiscussions, type PollStats } from './poll-vk.js';
import { publishPregameTopic, type PregameTopicStats } from './pregame-topic.js';
import { processPendingCommands } from './process-commands.js';
import { processGameAlerts, type GameAlertStats } from './process-game-alerts.js';
import { processDueReminders } from './process-reminders.js';

const EXECUTION_BUDGET_MILLISECONDS = 45_000;
/** Etapas opcionais só começam se ainda restar esse tempo do orçamento. */
const OPTIONAL_STEP_MINIMUM_MILLISECONDS = 8_000;

export interface BotJobResult {
  executionId: string;
  locked: boolean;
  poll?: PollStats;
  commands?: { completed: number; skipped: number; failed: number };
  reminders?: { sent: number; failed: number };
  gameAlerts?: GameAlertStats;
  matchFeed?: { posts: number };
  predictions?: { matchesSettled: number };
  bolaoTopics?: BolaoTopicStats;
  pregameTopic?: PregameTopicStats;
  activityBackfill?: ActivityBackfillStats;
  durationMs: number;
}

export async function runBotJob(): Promise<BotJobResult> {
  const startedAt = Date.now();
  const deadline = startedAt + EXECUTION_BUDGET_MILLISECONDS;
  const executionId = randomUUID();
  await connectDatabase();

  const locked = await acquireJobLease(executionId, new Date(startedAt));
  if (!locked) {
    log('info', 'job.skipped.locked', { executionId });
    return { executionId, locked: true, durationMs: Date.now() - startedAt };
  }

  try {
    const config = getConfig();
    const vk = new VkClient(config);
    const football = getFootballService();
    let poll: PollStats | undefined;
    let pollError: unknown;
    try {
      poll = await pollVkDiscussions(vk, deadline);
    } catch (error) {
      pollError = error;
      log('error', 'poll.failed', { executionId, error });
    }

    const commands = await processPendingCommands(vk, deadline, 25);
    const reminders = await processDueReminders(vk, deadline, 25);

    // Etapas opcionais: falhas são registradas, mas não interrompem o restante do job.
    const optional = async <T>(name: string, step: () => Promise<T>): Promise<T | undefined> => {
      if (Date.now() + OPTIONAL_STEP_MINIMUM_MILLISECONDS >= deadline) return undefined;
      try {
        return await step();
      } catch (error) {
        log('error', `${name}.failed`, { executionId, error });
        return undefined;
      }
    };

    const gameAlerts = await optional('game_alerts', () =>
      processGameAlerts(vk, football, deadline),
    );
    const { matchTopicId } = config;
    const matchFeed = matchTopicId
      ? await optional('match_feed', () => runMatchFeed(vk, football, matchTopicId, deadline))
      : undefined;
    const predictions = await optional('predictions', async () => {
      const summaries = await settlePredictions(football);
      if (matchTopicId && summaries.length > 0) {
        await postBolaoSummaries(vk, matchTopicId, summaries);
      }
      return { matchesSettled: summaries.length };
    });
    const bolaoTopics = await optional('bolao_topics', () =>
      publishBolaoTopics(vk, football, deadline),
    );
    const pregameTopic = await optional('pregame_topic', () => publishPregameTopic(vk, football));
    await optional('camisa7_snapshot', () => ensureDailyCamisa7Snapshot());

    let activityBackfill: ActivityBackfillStats | undefined;
    if (Date.now() + 12_000 < deadline) {
      try {
        activityBackfill = await runActivityBackfill(vk, deadline);
      } catch (error) {
        log('error', 'activity_backfill.failed', { executionId, error });
      }
    }
    if (pollError instanceof Error) throw pollError;
    if (pollError) throw new Error('Falha desconhecida no polling', { cause: pollError });

    const result: BotJobResult = {
      executionId,
      locked: false,
      ...(poll ? { poll } : {}),
      commands,
      reminders,
      ...(gameAlerts ? { gameAlerts } : {}),
      ...(matchFeed ? { matchFeed } : {}),
      ...(predictions ? { predictions } : {}),
      ...(bolaoTopics ? { bolaoTopics } : {}),
      ...(pregameTopic ? { pregameTopic } : {}),
      ...(activityBackfill ? { activityBackfill } : {}),
      durationMs: Date.now() - startedAt,
    };
    log('info', 'job.completed', { ...result });
    return result;
  } finally {
    await releaseJobLease(executionId);
  }
}
