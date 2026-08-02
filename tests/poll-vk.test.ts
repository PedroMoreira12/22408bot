import { beforeEach, describe, expect, it, vi } from 'vitest';

const modelMocks = vi.hoisted(() => ({
  commandUpdate: vi.fn(),
  stateFind: vi.fn(),
  stateUpdate: vi.fn(),
  cursorFind: vi.fn(),
  cursorUpdate: vi.fn(),
}));
const activityMocks = vi.hoisted(() => ({
  recordComments: vi.fn(),
  recordTopics: vi.fn(),
}));

vi.mock('../src/activity/record.js', () => ({
  recordCommentActivities: activityMocks.recordComments,
  recordTopicActivities: activityMocks.recordTopics,
}));

vi.mock('../src/models/command-job.js', () => ({
  CommandJob: { updateOne: modelMocks.commandUpdate },
}));
vi.mock('../src/models/job-state.js', () => ({
  JobState: { findById: modelMocks.stateFind, updateOne: modelMocks.stateUpdate },
}));
vi.mock('../src/models/topic-cursor.js', () => ({
  TopicCursor: { findOne: modelMocks.cursorFind, updateOne: modelMocks.cursorUpdate },
}));

import type { VkClient } from '../src/clients/vk.js';
import { pollVkDiscussions } from '../src/jobs/poll-vk.js';

describe('pollVkDiscussions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.recordComments.mockResolvedValue(3);
    activityMocks.recordTopics.mockResolvedValue(1);
  });

  it('enfileira todos os comandos novos em ordem e ignora texto comum', async () => {
    const now = new Date();
    modelMocks.stateFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        initializedAt: new Date(now.getTime() - 60_000),
        lastSuccessfulPollAt: new Date(now.getTime() - 60_000),
      }),
    });
    modelMocks.commandUpdate.mockResolvedValue({ upsertedCount: 1 });
    modelMocks.stateUpdate.mockResolvedValue({ acknowledged: true });
    modelMocks.cursorUpdate.mockResolvedValue({ acknowledged: true });
    modelMocks.cursorFind.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    const getTopics = vi.fn().mockResolvedValue({
      count: 1,
      items: [{ id: 7, title: 'Jogo', updated: Math.floor(now.getTime() / 1_000) }],
    });
    const getComments = vi.fn().mockResolvedValue({
      count: 3,
      items: [
        { id: 12, from_id: 2, date: Math.floor(now.getTime() / 1_000), text: '!gsd' },
        { id: 11, from_id: 1, date: Math.floor(now.getTime() / 1_000) - 1, text: 'normal' },
        { id: 10, from_id: 1, date: Math.floor(now.getTime() / 1_000) - 2, text: '!c oi' },
      ],
      profiles: [
        { id: 1, first_name: 'Ana' },
        { id: 2, first_name: 'Bia' },
      ],
    });
    const vk = { getTopics, getComments, groupId: 123 } as unknown as VkClient;

    const result = await pollVkDiscussions(vk, Date.now() + 10_000, now);

    expect(result.commentsFound).toBe(3);
    expect(result.commandsQueued).toBe(2);
    expect(result.activitiesRecorded).toBe(4);
    expect(activityMocks.recordComments).toHaveBeenCalledWith(
      expect.any(Number),
      7,
      expect.arrayContaining([
        expect.objectContaining({ id: 10 }),
        expect.objectContaining({ id: 11 }),
        expect.objectContaining({ id: 12 }),
      ]),
      { source: 'live' },
    );
    expect(modelMocks.commandUpdate).toHaveBeenCalledTimes(2);
    expect(modelMocks.commandUpdate.mock.calls[0]?.[0]).toMatchObject({ commentId: '10' });
    expect(modelMocks.commandUpdate.mock.calls[1]?.[0]).toMatchObject({ commentId: '12' });
  });

  it('inicializa cursores sem enfileirar histórico', async () => {
    const now = new Date();
    modelMocks.stateFind.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    modelMocks.stateUpdate.mockResolvedValue({ acknowledged: true });
    modelMocks.cursorUpdate.mockResolvedValue({ acknowledged: true });
    const vk = {
      groupId: 123,
      getTopics: vi.fn().mockResolvedValue({
        count: 1,
        items: [{ id: 7, title: 'Jogo', updated: Math.floor(now.getTime() / 1_000) }],
      }),
      getComments: vi.fn().mockResolvedValue({
        count: 1,
        items: [{ id: 12, from_id: 2, date: Math.floor(now.getTime() / 1_000), text: '!gsd' }],
      }),
    } as unknown as VkClient;

    const result = await pollVkDiscussions(vk, Date.now() + 10_000, now);
    expect(result.initialized).toBe(true);
    expect(result.cursorsSeeded).toBe(1);
    expect(result.activitiesRecorded).toBe(1);
    expect(activityMocks.recordTopics).toHaveBeenCalledOnce();
    expect(activityMocks.recordComments).not.toHaveBeenCalled();
    expect(modelMocks.commandUpdate).not.toHaveBeenCalled();
  });

  it('ignora comandos com mais de 24 horas após uma interrupção longa', async () => {
    const now = new Date('2026-08-02T12:00:00.000Z');
    const oneYearAgo = new Date('2025-08-02T12:00:00.000Z');
    modelMocks.stateFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        initializedAt: oneYearAgo,
        lastSuccessfulPollAt: oneYearAgo,
      }),
    });
    modelMocks.commandUpdate.mockResolvedValue({ upsertedCount: 1 });
    modelMocks.stateUpdate.mockResolvedValue({ acknowledged: true });
    modelMocks.cursorUpdate.mockResolvedValue({ acknowledged: true });
    modelMocks.cursorFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ lastCommentId: '10' }),
    });

    const getTopics = vi.fn().mockResolvedValue({
      count: 1,
      items: [{ id: 7, title: 'Jogo', updated: Math.floor(now.getTime() / 1_000) }],
    });
    const getComments = vi.fn().mockResolvedValue({
      count: 2,
      items: [
        { id: 30, from_id: 2, date: Math.floor(now.getTime() / 1_000), text: '!gsd' },
        {
          id: 20,
          from_id: 1,
          date: Math.floor((now.getTime() - 25 * 60 * 60_000) / 1_000),
          text: '!tutorial',
        },
      ],
    });
    const vk = { getTopics, getComments, groupId: 123 } as unknown as VkClient;

    const result = await pollVkDiscussions(vk, Date.now() + 10_000, now);

    expect(result.commentsFound).toBe(1);
    expect(result.commandsQueued).toBe(1);
    expect(modelMocks.commandUpdate).toHaveBeenCalledTimes(1);
    expect(modelMocks.commandUpdate).toHaveBeenCalledWith(
      { topicId: '7', commentId: '30' },
      expect.any(Object),
      { upsert: true },
    );
    expect(modelMocks.cursorUpdate).toHaveBeenCalledWith(
      { topicId: '7' },
      expect.objectContaining({ $set: expect.objectContaining({ lastCommentId: '30' }) }),
      { upsert: true },
    );
  });
});
