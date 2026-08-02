import type { AnyBulkWriteOperation } from 'mongoose';

import type { VkComment, VkTopic } from '../clients/vk.js';
import {
  ActivityEvent,
  type ActivityEventRecord,
  type ActivityEventSource,
} from '../models/activity-event.js';
import { parseCommand } from '../commands/parser.js';
import { activityDate, ACTIVITY_BACKFILL_CUTOFF } from './time.js';

interface RecordOptions {
  source: ActivityEventSource;
  earliestAt?: Date;
  latestAt?: Date;
}

export async function recordCommentActivities(
  groupId: number,
  topicId: number,
  comments: VkComment[],
  options: RecordOptions,
): Promise<number> {
  const operations = comments.flatMap((comment) => {
    if (comment.from_id <= 0) return [];
    const occurredAt = new Date(comment.date * 1_000);
    if (!isWithinRange(occurredAt, options)) return [];
    const { year, dateKey } = activityDate(occurredAt);
    return [
      insertOperation({
        eventKey: `board-comment:${topicId}:${comment.id}`,
        groupId: String(groupId),
        userId: String(comment.from_id),
        type: 'comment',
        source: options.source,
        topicId: String(topicId),
        commentId: String(comment.id),
        occurredAt,
        year,
        dateKey,
        isCommand: Boolean(parseCommand(comment.text)),
      }),
    ];
  });
  return executeOperations(operations);
}

export async function recordTopicActivities(
  groupId: number,
  topics: VkTopic[],
  options: RecordOptions,
): Promise<number> {
  const operations = topics.flatMap((topic) => {
    if (!topic.created || !topic.created_by || topic.created_by <= 0) return [];
    const occurredAt = new Date(topic.created * 1_000);
    if (!isWithinRange(occurredAt, options)) return [];
    const { year, dateKey } = activityDate(occurredAt);
    return [
      insertOperation({
        eventKey: `board-topic:${topic.id}`,
        groupId: String(groupId),
        userId: String(topic.created_by),
        type: 'topic',
        source: options.source,
        topicId: String(topic.id),
        occurredAt,
        year,
        dateKey,
        isCommand: false,
      }),
    ];
  });
  return executeOperations(operations);
}

function insertOperation(
  event: Omit<ActivityEventRecord, 'createdAt' | 'updatedAt'>,
): AnyBulkWriteOperation<ActivityEventRecord> {
  return {
    updateOne: {
      filter: { groupId: event.groupId, eventKey: event.eventKey },
      update: { $setOnInsert: event },
      upsert: true,
    },
  };
}

async function executeOperations(
  operations: Array<AnyBulkWriteOperation<ActivityEventRecord>>,
): Promise<number> {
  if (operations.length === 0) return 0;
  const result = await ActivityEvent.bulkWrite(operations, { ordered: false });
  return result.upsertedCount;
}

function isWithinRange(occurredAt: Date, options: RecordOptions): boolean {
  const earliestAt = options.earliestAt ?? ACTIVITY_BACKFILL_CUTOFF;
  return occurredAt >= earliestAt && (!options.latestAt || occurredAt <= options.latestAt);
}
