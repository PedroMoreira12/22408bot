import type { VkClient, VkComment, VkGroup, VkProfile, VkTopic } from '../clients/vk.js';
import { parseCommand } from '../commands/parser.js';
import { CommandJob } from '../models/command-job.js';
import { JobState } from '../models/job-state.js';
import { TopicCursor } from '../models/topic-cursor.js';

const STATE_ID = 'main';
const OVERLAP_MILLISECONDS = 2 * 60_000;
const MAX_CATCHUP_MILLISECONDS = 24 * 60 * 60_000;
const TOPIC_PAGE_SIZE = 100;
const COMMENT_PAGE_SIZE = 100;
const MAX_TOPIC_PAGES = 5;
const MAX_COMMENT_PAGES = 10;

export interface PollStats {
  initialized: boolean;
  topicsScanned: number;
  commentsFound: number;
  commandsQueued: number;
  cursorsSeeded: number;
}

export async function pollVkDiscussions(
  vk: VkClient,
  deadline: number,
  now = new Date(),
): Promise<PollStats> {
  const state = await JobState.findById(STATE_ID).lean();
  const previousPollAt = state?.lastSuccessfulPollAt ?? state?.initializedAt;
  const since =
    state?.initializedAt && previousPollAt ? calculatePollingStart(previousPollAt, now) : undefined;
  const topics = await getRecentlyUpdatedTopics(vk, since, now, deadline);

  if (!state?.initializedAt) {
    const cursorsSeeded = await seedTopicCursors(vk, topics, deadline);
    await JobState.updateOne(
      { _id: STATE_ID },
      { $set: { initializedAt: now, lastSuccessfulPollAt: now } },
      { upsert: true },
    );
    return {
      initialized: true,
      topicsScanned: topics.length,
      commentsFound: 0,
      commandsQueued: 0,
      cursorsSeeded,
    };
  }

  if (!since) throw new Error('Estado do polling inicializado sem data de referência');
  let commentsFound = 0;
  let commandsQueued = 0;
  let topicsScanned = 0;

  for (const topic of topics) {
    if (Date.now() >= deadline) throw new Error('Prazo do polling esgotado antes de concluir');
    const result = await scanTopic(vk, topic, since, deadline);
    commentsFound += result.commentsFound;
    commandsQueued += result.commandsQueued;
    topicsScanned += 1;
  }

  await JobState.updateOne({ _id: STATE_ID }, { $set: { lastSuccessfulPollAt: now } });
  return { initialized: false, topicsScanned, commentsFound, commandsQueued, cursorsSeeded: 0 };
}

async function getRecentlyUpdatedTopics(
  vk: VkClient,
  since: Date | undefined,
  now: Date,
  deadline: number,
): Promise<VkTopic[]> {
  const sinceSeconds = since ? Math.floor(since.getTime() / 1_000) : 0;
  const topics: VkTopic[] = [];
  let complete = false;

  for (let page = 0; page < MAX_TOPIC_PAGES && Date.now() < deadline; page += 1) {
    const response = await vk.getTopics(page * TOPIC_PAGE_SIZE, TOPIC_PAGE_SIZE);
    topics.push(...response.items.filter((topic) => !since || topic.updated >= sinceSeconds));
    if (response.items.length < TOPIC_PAGE_SIZE) {
      complete = true;
      break;
    }
    const latestOnPage = Math.max(...response.items.map((topic) => topic.updated));
    if (since && latestOnPage < sinceSeconds) {
      complete = true;
      break;
    }
  }

  if (since && !complete) throw new Error('Backlog de tópicos excedeu o limite seguro');

  return topics.filter((topic) => topic.updated <= Math.floor(now.getTime() / 1_000) + 60);
}

function calculatePollingStart(previousPollAt: Date, now: Date): Date {
  return new Date(
    Math.max(
      previousPollAt.getTime() - OVERLAP_MILLISECONDS,
      now.getTime() - MAX_CATCHUP_MILLISECONDS,
    ),
  );
}

async function seedTopicCursors(
  vk: VkClient,
  topics: VkTopic[],
  deadline: number,
): Promise<number> {
  let seeded = 0;
  for (const topic of topics) {
    if (Date.now() >= deadline) break;
    const response = await vk.getComments(topic.id, 0, 1);
    const latest = response.items[0];
    if (!latest) continue;
    await saveCursor(topic.id, latest);
    seeded += 1;
  }
  return seeded;
}

async function scanTopic(
  vk: VkClient,
  topic: VkTopic,
  since: Date,
  deadline: number,
): Promise<{ commentsFound: number; commandsQueued: number }> {
  const cursor = await TopicCursor.findOne({ topicId: String(topic.id) }).lean();
  const comments: VkComment[] = [];
  const profiles = new Map<number, string>();
  let latestComment: VkComment | undefined;
  let complete = false;

  for (let page = 0; page < MAX_COMMENT_PAGES && Date.now() < deadline; page += 1) {
    const response = await vk.getComments(topic.id, page * COMMENT_PAGE_SIZE, COMMENT_PAGE_SIZE);
    latestComment ??= response.items[0];
    addProfiles(profiles, response.profiles);
    addGroups(profiles, response.groups);
    const cursorIndex = cursor
      ? response.items.findIndex((comment) => String(comment.id) === cursor.lastCommentId)
      : -1;
    const unseenItems = cursorIndex >= 0 ? response.items.slice(0, cursorIndex) : response.items;
    const recent = unseenItems.filter((comment) => comment.date * 1_000 >= since.getTime());
    comments.push(...recent);
    const oldest = response.items.at(-1);
    if (
      cursorIndex >= 0 ||
      response.items.length < COMMENT_PAGE_SIZE ||
      !oldest ||
      oldest.date * 1_000 < since.getTime()
    ) {
      complete = true;
      break;
    }
  }

  if (!complete) throw new Error(`Backlog do tópico ${topic.id} excedeu o limite seguro`);

  let commandsQueued = 0;
  const ordered = comments.sort((left, right) => left.date - right.date || left.id - right.id);
  for (const comment of ordered) {
    if (!parseCommand(comment.text)) continue;
    const result = await CommandJob.updateOne(
      { topicId: String(topic.id), commentId: String(comment.id) },
      {
        $setOnInsert: {
          userId: String(comment.from_id),
          topicTitle: topic.title,
          text: comment.text,
          ...(profiles.get(comment.from_id) ? { authorName: profiles.get(comment.from_id) } : {}),
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true },
    );
    commandsQueued += result.upsertedCount;
  }

  if (latestComment) await saveCursor(topic.id, latestComment);
  return { commentsFound: comments.length, commandsQueued };
}

function addProfiles(target: Map<number, string>, profiles: VkProfile[] | undefined): void {
  for (const profile of profiles ?? []) target.set(profile.id, profile.first_name);
}

function addGroups(target: Map<number, string>, groups: VkGroup[] | undefined): void {
  for (const group of groups ?? []) target.set(-group.id, group.name);
}

async function saveCursor(topicId: number, comment: VkComment): Promise<void> {
  await TopicCursor.updateOne(
    { topicId: String(topicId) },
    {
      $set: {
        lastCommentId: String(comment.id),
        lastCommentDate: new Date(comment.date * 1_000),
      },
    },
    { upsert: true },
  );
}
