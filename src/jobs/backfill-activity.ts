import type { AnyBulkWriteOperation } from 'mongoose';

import { recordCommentActivities, recordTopicActivities } from '../activity/record.js';
import { ACTIVITY_BACKFILL_CUTOFF } from '../activity/time.js';
import type { VkClient, VkTopic } from '../clients/vk.js';
import { log } from '../lib/logger.js';
import {
  ActivityBackfillState,
  type ActivityBackfillStateRecord,
  type ActivityBackfillStatus,
} from '../models/activity-backfill-state.js';
import {
  ActivityBackfillTopic,
  type ActivityBackfillTopicRecord,
} from '../models/activity-backfill-topic.js';

const STATE_ID = 'board-activity-2026';
const PAGE_SIZE = 100;
const MAX_TOPIC_PAGES_PER_RUN = 2;
const MAX_COMMENT_PAGES_PER_RUN = 5;
const MINIMUM_REMAINING_MILLISECONDS = 12_000;
const TOPIC_LEASE_MILLISECONDS = 60_000;
const MAX_ATTEMPTS = 10;

export interface ActivityBackfillStats {
  status: ActivityBackfillStatus;
  topicPages: number;
  commentPages: number;
  topicsDiscovered: number;
  commentsScanned: number;
  eventsInserted: number;
  totalTopicsDiscovered: number;
  totalCommentsScanned: number;
  totalEventsInserted: number;
  failedTopics: number;
}

export async function runActivityBackfill(
  vk: VkClient,
  deadline: number,
  now = new Date(),
): Promise<ActivityBackfillStats> {
  await initializeState(now);
  let state = await getState();
  const stats: ActivityBackfillStats = {
    status: state.status,
    topicPages: 0,
    commentPages: 0,
    topicsDiscovered: 0,
    commentsScanned: 0,
    eventsInserted: 0,
    totalTopicsDiscovered: state.topicsDiscovered,
    totalCommentsScanned: state.commentsScanned,
    totalEventsInserted: state.eventsInserted,
    failedTopics: 0,
  };

  if (state.status === 'completed' || state.status === 'completed_with_errors') {
    stats.failedTopics = await ActivityBackfillTopic.countDocuments({ status: 'failed' });
    return stats;
  }

  if (state.status === 'discovering') {
    await discoverTopics(vk, state, deadline, stats);
    state = await getState();
  }

  if (state.status === 'collecting') {
    await collectComments(vk, state, deadline, stats);
    await finalizeIfFinished(now);
    state = await getState();
  }

  stats.status = state.status;
  stats.totalTopicsDiscovered = state.topicsDiscovered;
  stats.totalCommentsScanned = state.commentsScanned;
  stats.totalEventsInserted = state.eventsInserted;
  stats.failedTopics = await ActivityBackfillTopic.countDocuments({ status: 'failed' });
  return stats;
}

async function initializeState(now: Date): Promise<void> {
  await ActivityBackfillState.updateOne(
    { _id: STATE_ID },
    {
      $setOnInsert: {
        status: 'discovering',
        cutoffAt: ACTIVITY_BACKFILL_CUTOFF,
        upperBoundAt: now,
        nextTopicOffset: 0,
        topicsDiscovered: 0,
        commentsScanned: 0,
        eventsInserted: 0,
      },
    },
    { upsert: true },
  );
}

async function getState(): Promise<ActivityBackfillStateRecord> {
  const state = await ActivityBackfillState.findById(STATE_ID).lean();
  if (!state) throw new Error('Estado do backfill de atividades não encontrado');
  return state;
}

async function discoverTopics(
  vk: VkClient,
  initialState: ActivityBackfillStateRecord,
  deadline: number,
  stats: ActivityBackfillStats,
): Promise<void> {
  let offset = initialState.nextTopicOffset;
  const cutoffSeconds = Math.floor(initialState.cutoffAt.getTime() / 1_000);

  for (let page = 0; page < MAX_TOPIC_PAGES_PER_RUN && hasBudget(deadline); page += 1) {
    const response = await vk.getTopics(offset, PAGE_SIZE, 1);
    stats.topicPages += 1;
    const eligible = response.items.filter(
      (topic) =>
        topic.updated >= cutoffSeconds &&
        (!topic.created || topic.created * 1_000 <= initialState.upperBoundAt.getTime()),
    );
    const topicsDiscovered = await queueTopics(eligible);
    const eventsInserted = await recordTopicActivities(vk.groupId, eligible, {
      source: 'backfill',
      earliestAt: initialState.cutoffAt,
      latestAt: initialState.upperBoundAt,
    });
    stats.topicsDiscovered += topicsDiscovered;
    stats.eventsInserted += eventsInserted;
    offset += response.items.length;

    const reachedCutoff = hasReachedCutoff(response.items, cutoffSeconds);
    const discoveryComplete = response.items.length < PAGE_SIZE || reachedCutoff;
    await ActivityBackfillState.updateOne(
      { _id: STATE_ID, status: 'discovering' },
      {
        $set: {
          nextTopicOffset: offset,
          ...(discoveryComplete ? { status: 'collecting', discoveryCompletedAt: new Date() } : {}),
        },
        $inc: { topicsDiscovered, eventsInserted },
      },
    );
    if (discoveryComplete) break;
  }
}

async function queueTopics(topics: VkTopic[]): Promise<number> {
  const operations: Array<AnyBulkWriteOperation<ActivityBackfillTopicRecord>> = topics.map(
    (topic) => ({
      updateOne: {
        filter: { topicId: String(topic.id) },
        update: {
          $setOnInsert: {
            topicId: String(topic.id),
            ...(topic.created ? { topicCreatedAt: new Date(topic.created * 1_000) } : {}),
            topicUpdatedAt: new Date(topic.updated * 1_000),
            status: 'pending',
            nextCommentOffset: 0,
            attempts: 0,
            nextAttemptAt: new Date(0),
            commentsScanned: 0,
            eventsInserted: 0,
          },
        },
        upsert: true,
      },
    }),
  );
  if (operations.length === 0) return 0;
  const result = await ActivityBackfillTopic.bulkWrite(operations, { ordered: false });
  return result.upsertedCount;
}

function hasReachedCutoff(topics: VkTopic[], cutoffSeconds: number): boolean {
  const unpinned = topics.filter((topic) => topic.is_fixed !== 1);
  const oldest = unpinned.at(-1);
  return Boolean(oldest && oldest.updated < cutoffSeconds);
}

async function collectComments(
  vk: VkClient,
  state: ActivityBackfillStateRecord,
  deadline: number,
  stats: ActivityBackfillStats,
): Promise<void> {
  for (let page = 0; page < MAX_COMMENT_PAGES_PER_RUN && hasBudget(deadline); page += 1) {
    const topic = await claimTopic();
    if (!topic) break;

    try {
      const response = await vk.getComments(
        Number(topic.topicId),
        topic.nextCommentOffset,
        PAGE_SIZE,
      );
      stats.commentPages += 1;
      stats.commentsScanned += response.items.length;
      const eventsInserted = await recordCommentActivities(
        vk.groupId,
        Number(topic.topicId),
        response.items,
        {
          source: 'backfill',
          earliestAt: state.cutoffAt,
          latestAt: state.upperBoundAt,
        },
      );
      stats.eventsInserted += eventsInserted;
      const oldest = response.items.at(-1);
      const complete =
        response.items.length < PAGE_SIZE ||
        !oldest ||
        oldest.date * 1_000 < state.cutoffAt.getTime();
      await recordTopicPageSuccess(topic, response.items.length, eventsInserted, complete);
      await ActivityBackfillState.updateOne(
        { _id: STATE_ID },
        {
          $inc: {
            commentsScanned: response.items.length,
            eventsInserted,
          },
        },
      );
    } catch (error) {
      await recordTopicFailure(topic, error);
      log('error', 'activity_backfill.topic_failed', {
        topicId: topic.topicId,
        attempt: topic.attempts + 1,
        error,
      });
    }
  }
}

async function claimTopic(): Promise<ActivityBackfillTopicRecord | null> {
  const now = new Date();
  return ActivityBackfillTopic.findOneAndUpdate(
    {
      $and: [
        {
          $or: [
            { status: 'pending' },
            { status: 'processing', leaseUntil: { $lte: now } },
            { status: 'processing', leaseUntil: { $exists: false } },
          ],
        },
        { $or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: { $exists: false } }] },
      ],
    },
    {
      $set: {
        status: 'processing',
        leaseUntil: new Date(now.getTime() + TOPIC_LEASE_MILLISECONDS),
      },
    },
    { returnDocument: 'after', sort: { topicUpdatedAt: -1, createdAt: 1 } },
  ).lean();
}

async function recordTopicPageSuccess(
  topic: ActivityBackfillTopicRecord,
  commentsScanned: number,
  eventsInserted: number,
  complete: boolean,
): Promise<void> {
  await ActivityBackfillTopic.updateOne(
    { topicId: topic.topicId, status: 'processing' },
    {
      $set: {
        status: complete ? 'completed' : 'pending',
        nextAttemptAt: new Date(0),
        ...(complete ? { completedAt: new Date() } : {}),
      },
      $inc: {
        nextCommentOffset: commentsScanned,
        commentsScanned,
        eventsInserted,
      },
      $unset: { leaseUntil: 1, lastError: 1 },
    },
  );
}

async function recordTopicFailure(
  topic: ActivityBackfillTopicRecord,
  error: unknown,
): Promise<void> {
  const attempts = topic.attempts + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  await ActivityBackfillTopic.updateOne(
    { topicId: topic.topicId, status: 'processing' },
    {
      $set: {
        status: terminal ? 'failed' : 'pending',
        attempts,
        nextAttemptAt: nextRetryDate(attempts),
        lastError: errorMessage(error),
      },
      $unset: { leaseUntil: 1 },
    },
  );
}

async function finalizeIfFinished(now: Date): Promise<void> {
  const remaining = await ActivityBackfillTopic.exists({
    status: { $in: ['pending', 'processing'] },
  });
  if (remaining) return;
  const failedTopics = await ActivityBackfillTopic.countDocuments({ status: 'failed' });
  await ActivityBackfillState.updateOne(
    { _id: STATE_ID, status: 'collecting' },
    {
      $set: {
        status: failedTopics > 0 ? 'completed_with_errors' : 'completed',
        completedAt: now,
      },
    },
  );
}

function hasBudget(deadline: number): boolean {
  return Date.now() + MINIMUM_REMAINING_MILLISECONDS < deadline;
}

function nextRetryDate(attempts: number, now = new Date()): Date {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
