import { ActivityEvent } from '../models/activity-event.js';

export interface CommunityRetrospective {
  participants: number;
  comments: number;
  topics: number;
  activeDays: number;
  commands: number;
  busiestDay: { dateKey: string; events: number } | null;
}

export interface CommunityRecordCandidate {
  userId: string;
  comments: number;
  topics: number;
  dateKeys: string[];
}

export async function getCommunityRetrospective(
  groupId: number,
  year: number,
): Promise<CommunityRetrospective> {
  const [summary, busiest] = await Promise.all([
    ActivityEvent.aggregate<{
      participants: string[];
      comments: number;
      topics: number;
      activeDays: string[];
      commands: number;
    }>([
      { $match: { groupId: String(groupId), year } },
      {
        $group: {
          _id: null,
          participants: { $addToSet: '$userId' },
          comments: { $sum: { $cond: [{ $eq: ['$type', 'comment'] }, 1, 0] } },
          topics: { $sum: { $cond: [{ $eq: ['$type', 'topic'] }, 1, 0] } },
          activeDays: { $addToSet: '$dateKey' },
          commands: { $sum: { $cond: ['$isCommand', 1, 0] } },
        },
      },
      { $project: { _id: 0, participants: 1, comments: 1, topics: 1, activeDays: 1, commands: 1 } },
    ]),
    ActivityEvent.aggregate<{ _id: string; events: number }>([
      { $match: { groupId: String(groupId), year } },
      { $group: { _id: '$dateKey', events: { $sum: 1 } } },
      { $sort: { events: -1, _id: 1 } },
      { $limit: 1 },
    ]),
  ]);
  const summaryData = summary[0];
  const busiestData = busiest[0];
  return {
    participants: summaryData?.participants.length ?? 0,
    comments: summaryData?.comments ?? 0,
    topics: summaryData?.topics ?? 0,
    activeDays: summaryData?.activeDays.length ?? 0,
    commands: summaryData?.commands ?? 0,
    busiestDay: busiestData ? { dateKey: busiestData._id, events: busiestData.events } : null,
  };
}

export async function getCommunityRecordCandidates(
  groupId: number,
  year: number,
): Promise<CommunityRecordCandidate[]> {
  return ActivityEvent.aggregate<CommunityRecordCandidate>([
    { $match: { groupId: String(groupId), year } },
    {
      $group: {
        _id: '$userId',
        comments: { $sum: { $cond: [{ $eq: ['$type', 'comment'] }, 1, 0] } },
        topics: { $sum: { $cond: [{ $eq: ['$type', 'topic'] }, 1, 0] } },
        dateKeys: { $addToSet: '$dateKey' },
      },
    },
    { $sort: { comments: -1, topics: -1, _id: 1 } },
    { $project: { _id: 0, userId: '$_id', comments: 1, topics: 1, dateKeys: 1 } },
  ]);
}

export function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}
