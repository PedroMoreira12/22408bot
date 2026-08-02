import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMocks = vi.hoisted(() => ({ bulkWrite: vi.fn() }));
vi.mock('../src/models/activity-event.js', () => ({
  ActivityEvent: { bulkWrite: activityMocks.bulkWrite },
}));

import { recordCommentActivities, recordTopicActivities } from '../src/activity/record.js';

interface BulkOperationShape {
  updateOne: { update: { $setOnInsert: Record<string, unknown> } };
}

describe('registro de atividades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.bulkWrite.mockResolvedValue({ upsertedCount: 1 });
  });

  it('registra comentários comuns e comandos sem armazenar o texto', async () => {
    const count = await recordCommentActivities(
      123,
      7,
      [
        { id: 10, from_id: 1, date: epoch('2026-01-01T03:00:00.000Z'), text: 'comentário pessoal' },
        { id: 11, from_id: 2, date: epoch('2026-01-01T03:01:00.000Z'), text: '!jogo' },
        {
          id: 12,
          from_id: -123,
          date: epoch('2026-01-01T03:02:00.000Z'),
          text: 'resposta da comunidade',
        },
      ],
      { source: 'live' },
    );

    expect(count).toBe(1);
    const operations = activityMocks.bulkWrite.mock.calls[0]?.[0] as
      BulkOperationShape[] | undefined;
    if (!operations) throw new Error('Operações não registradas');
    expect(operations).toHaveLength(2);
    const [first, second] = operations;
    if (!first || !second) throw new Error('Eventos esperados não registrados');
    expect(first.updateOne.update.$setOnInsert).toMatchObject({
      eventKey: 'board-comment:7:10',
      groupId: '123',
      userId: '1',
      year: 2026,
      dateKey: '2026-01-01',
      isCommand: false,
    });
    expect(second.updateOne.update.$setOnInsert.isCommand).toBe(true);
    expect(JSON.stringify(operations)).not.toContain('comentário pessoal');
    expect(activityMocks.bulkWrite).toHaveBeenCalledWith(operations, { ordered: false });
  });

  it('ignora atividades anteriores ao início de 2026 em São Paulo', async () => {
    await recordCommentActivities(
      123,
      7,
      [{ id: 9, from_id: 1, date: epoch('2026-01-01T02:59:59.000Z'), text: 'antes do corte' }],
      { source: 'backfill' },
    );

    expect(activityMocks.bulkWrite).not.toHaveBeenCalled();
  });

  it('registra autoria e data de criação dos tópicos', async () => {
    await recordTopicActivities(
      123,
      [
        {
          id: 50,
          title: 'Temporada',
          created: epoch('2026-01-01T03:00:00.000Z'),
          created_by: 4,
          updated: epoch('2026-01-01T03:02:00.000Z'),
        },
      ],
      { source: 'backfill' },
    );

    const operations = activityMocks.bulkWrite.mock.calls[0]?.[0] as
      BulkOperationShape[] | undefined;
    const event = operations?.[0]?.updateOne.update.$setOnInsert;
    expect(event).toMatchObject({
      eventKey: 'board-topic:50',
      userId: '4',
      type: 'topic',
      year: 2026,
      isCommand: false,
    });
  });
});

function epoch(value: string): number {
  return Math.floor(new Date(value).getTime() / 1_000);
}
