import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stateUpdate: vi.fn(),
  stateFind: vi.fn(),
  topicBulkWrite: vi.fn(),
  topicClaim: vi.fn(),
  topicUpdate: vi.fn(),
  topicExists: vi.fn(),
  topicCount: vi.fn(),
  recordComments: vi.fn(),
  recordTopics: vi.fn(),
}));

vi.mock('../src/models/activity-backfill-state.js', () => ({
  ActivityBackfillState: { updateOne: mocks.stateUpdate, findById: mocks.stateFind },
}));
vi.mock('../src/models/activity-backfill-topic.js', () => ({
  ActivityBackfillTopic: {
    bulkWrite: mocks.topicBulkWrite,
    findOneAndUpdate: mocks.topicClaim,
    updateOne: mocks.topicUpdate,
    exists: mocks.topicExists,
    countDocuments: mocks.topicCount,
  },
}));
vi.mock('../src/activity/record.js', () => ({
  recordCommentActivities: mocks.recordComments,
  recordTopicActivities: mocks.recordTopics,
}));

import type { VkClient } from '../src/clients/vk.js';
import { runActivityBackfill } from '../src/jobs/backfill-activity.js';

const cutoffAt = new Date('2026-01-01T03:00:00.000Z');
const upperBoundAt = new Date('2026-08-05T12:00:00.000Z');

function state(status: 'discovering' | 'collecting' | 'completed') {
  return {
    _id: 'board-activity-2026',
    status,
    cutoffAt,
    upperBoundAt,
    nextTopicOffset: 0,
    topicsDiscovered: 0,
    commentsScanned: 0,
    eventsInserted: 0,
  };
}

function findResult(value: unknown) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

describe('backfill anual de atividades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateUpdate.mockResolvedValue({ acknowledged: true });
    mocks.topicUpdate.mockResolvedValue({ acknowledged: true });
    mocks.topicBulkWrite.mockResolvedValue({ upsertedCount: 1 });
    mocks.topicExists.mockResolvedValue(null);
    mocks.topicCount.mockResolvedValue(0);
    mocks.recordTopics.mockResolvedValue(1);
    mocks.recordComments.mockResolvedValue(2);
  });

  it('descobre tópicos atualizados desde o corte, incluindo tópicos antigos', async () => {
    mocks.stateFind
      .mockReturnValueOnce(findResult(state('discovering')))
      .mockReturnValueOnce(findResult(state('collecting')))
      .mockReturnValueOnce(findResult(state('completed')));
    mocks.topicClaim.mockReturnValue(findResult(null));
    const getTopics = vi.fn().mockResolvedValue({
      count: 2,
      items: [
        {
          id: 10,
          title: 'Tópico antigo ainda ativo',
          created: epoch('2020-01-01T12:00:00.000Z'),
          created_by: 1,
          updated: epoch('2026-06-01T12:00:00.000Z'),
          is_fixed: 0,
        },
        {
          id: 9,
          title: 'Sem atividade em 2026',
          created: epoch('2020-01-01T12:00:00.000Z'),
          created_by: 2,
          updated: epoch('2025-12-01T12:00:00.000Z'),
          is_fixed: 0,
        },
      ],
    });
    const vk = { getTopics, groupId: 123 } as unknown as VkClient;

    const result = await runActivityBackfill(vk, Date.now() + 30_000, upperBoundAt);

    expect(result.status).toBe('completed');
    expect(result.topicPages).toBe(1);
    expect(getTopics).toHaveBeenCalledWith(0, 100, 1);
    expect(mocks.topicBulkWrite.mock.calls[0]?.[0]).toHaveLength(1);
    expect(mocks.recordTopics).toHaveBeenCalledWith(123, [expect.objectContaining({ id: 10 })], {
      source: 'backfill',
      earliestAt: cutoffAt,
      latestAt: upperBoundAt,
    });
  });

  it('pagina comentários e limita os eventos ao intervalo do backfill', async () => {
    mocks.stateFind
      .mockReturnValueOnce(findResult(state('collecting')))
      .mockReturnValueOnce(findResult(state('completed')));
    mocks.topicClaim
      .mockReturnValueOnce(
        findResult({
          topicId: '10',
          topicUpdatedAt: new Date('2026-06-01T12:00:00.000Z'),
          status: 'processing',
          nextCommentOffset: 100,
          attempts: 0,
          nextAttemptAt: new Date(0),
          commentsScanned: 100,
          eventsInserted: 90,
        }),
      )
      .mockReturnValueOnce(findResult(null));
    const comments = [
      { id: 2, from_id: 2, date: epoch('2026-06-01T12:00:00.000Z'), text: 'normal' },
      { id: 1, from_id: 1, date: epoch('2026-01-01T03:00:00.000Z'), text: '!jogo' },
    ];
    const getComments = vi.fn().mockResolvedValue({ count: 102, items: comments });
    const vk = { getComments, groupId: 123 } as unknown as VkClient;

    const result = await runActivityBackfill(vk, Date.now() + 30_000, upperBoundAt);

    expect(result.commentPages).toBe(1);
    expect(result.commentsScanned).toBe(2);
    expect(getComments).toHaveBeenCalledWith(10, 100, 100);
    expect(mocks.recordComments).toHaveBeenCalledWith(123, 10, comments, {
      source: 'backfill',
      earliestAt: cutoffAt,
      latestAt: upperBoundAt,
    });
    expect(mocks.topicUpdate).toHaveBeenCalledWith(
      { topicId: '10', status: 'processing' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'completed' }),
        $inc: expect.objectContaining({ commentsScanned: 2, eventsInserted: 2 }),
      }),
    );
  });
});

function epoch(value: string): number {
  return Math.floor(new Date(value).getTime() / 1_000);
}
