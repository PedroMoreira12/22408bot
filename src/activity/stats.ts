import { ActivityEvent } from '../models/activity-event.js';

export interface ActivityStats {
  comments: number;
  topics: number;
  activeDays: number;
  commands: number;
  firstActivity: Date | null;
  lastActivity: Date | null;
}

export interface ActivityRankingEntry {
  userId: string;
  comments: number;
  topics: number;
  activeDays: number;
  score: number;
}

export async function getActivityStats(
  groupId: number,
  userId: number,
  year: number,
): Promise<ActivityStats> {
  const [result] = await ActivityEvent.aggregate<ActivityStats>([
    { $match: { groupId: String(groupId), userId: String(userId), year } },
    {
      $group: {
        _id: null,
        comments: { $sum: { $cond: [{ $eq: ['$type', 'comment'] }, 1, 0] } },
        topics: { $sum: { $cond: [{ $eq: ['$type', 'topic'] }, 1, 0] } },
        activeDays: { $addToSet: '$dateKey' },
        commands: { $sum: { $cond: ['$isCommand', 1, 0] } },
        firstActivity: { $min: '$occurredAt' },
        lastActivity: { $max: '$occurredAt' },
      },
    },
    {
      $project: {
        _id: 0,
        comments: 1,
        topics: 1,
        activeDays: { $size: '$activeDays' },
        commands: 1,
        firstActivity: 1,
        lastActivity: 1,
      },
    },
  ]);
  return (
    result ?? {
      comments: 0,
      topics: 0,
      activeDays: 0,
      commands: 0,
      firstActivity: null,
      lastActivity: null,
    }
  );
}

export async function getActivityRanking(
  groupId: number,
  year: number,
  limit: number,
): Promise<ActivityRankingEntry[]> {
  return ActivityEvent.aggregate<ActivityRankingEntry>([
    { $match: { groupId: String(groupId), year } },
    {
      $group: {
        _id: { userId: '$userId', dateKey: '$dateKey' },
        comments: { $sum: { $cond: [{ $eq: ['$type', 'comment'] }, 1, 0] } },
        topics: { $sum: { $cond: [{ $eq: ['$type', 'topic'] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id.userId',
        comments: 1,
        topics: 1,
        activeDays: { $literal: 1 },
        score: {
          $add: [
            { $cond: [{ $gt: ['$comments', 20] }, 20, '$comments'] },
            {
              $multiply: [{ $cond: [{ $gt: ['$topics', 5] }, 5, '$topics'] }, 3],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$userId',
        comments: { $sum: '$comments' },
        topics: { $sum: '$topics' },
        activeDays: { $sum: '$activeDays' },
        score: { $sum: '$score' },
      },
    },
    { $sort: { score: -1, activeDays: -1, comments: -1, _id: 1 } },
    { $limit: limit * 3 },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        comments: 1,
        topics: 1,
        activeDays: 1,
        score: 1,
      },
    },
  ]);
}

export async function getActiveDates(
  groupId: number,
  userId: number,
  year: number,
): Promise<string[]> {
  return ActivityEvent.distinct('dateKey', {
    groupId: String(groupId),
    userId: String(userId),
    year,
  });
}

export function longestActiveSequence(dateKeys: string[]): number {
  const days = [...new Set(dateKeys)].sort();
  let longest = 0;
  let current = 0;
  let previous: Date | undefined;
  for (const dateKey of days) {
    const date = new Date(`${dateKey}T12:00:00-03:00`);
    if (previous && date.getTime() - previous.getTime() === 86_400_000) current += 1;
    else current = 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}
