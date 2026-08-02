import { randomUUID } from 'node:crypto';

import { VkClient } from '../clients/vk.js';
import { getConfig } from '../config.js';
import { connectDatabase } from '../db.js';
import { log } from '../lib/logger.js';
import { acquireJobLease, releaseJobLease } from './lease.js';
import { pollVkDiscussions, type PollStats } from './poll-vk.js';
import { processPendingCommands } from './process-commands.js';
import { processDueReminders } from './process-reminders.js';

const EXECUTION_BUDGET_MILLISECONDS = 45_000;

export interface BotJobResult {
  executionId: string;
  locked: boolean;
  poll?: PollStats;
  commands?: { completed: number; failed: number };
  reminders?: { sent: number; failed: number };
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
    const vk = new VkClient(getConfig());
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
    if (pollError instanceof Error) throw pollError;
    if (pollError) throw new Error('Falha desconhecida no polling', { cause: pollError });

    const result: BotJobResult = {
      executionId,
      locked: false,
      ...(poll ? { poll } : {}),
      commands,
      reminders,
      durationMs: Date.now() - startedAt,
    };
    log('info', 'job.completed', { ...result });
    return result;
  } finally {
    await releaseJobLease(executionId);
  }
}
