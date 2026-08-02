import { beforeEach, describe, expect, it, vi } from 'vitest';

const reminderMocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/models/reminder.js', () => ({ Reminder: reminderMocks }));

import type { VkClient } from '../src/clients/vk.js';
import { processDueReminders } from '../src/jobs/process-reminders.js';

const dueReminder = {
  _id: 'id-1',
  topicId: '7',
  messageId: '12',
  userId: '2',
  attempts: 1,
};

describe('processDueReminders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca como enviado somente após a resposta da VK', async () => {
    reminderMocks.findOneAndUpdate.mockResolvedValueOnce(dueReminder).mockResolvedValueOnce(null);
    reminderMocks.updateOne.mockResolvedValue({ acknowledged: true });
    const vk = {
      getUserFirstName: vi.fn().mockResolvedValue('Bia'),
      createComment: vi.fn().mockResolvedValue(99),
    } as unknown as VkClient;

    await expect(processDueReminders(vk, Date.now() + 10_000)).resolves.toEqual({
      sent: 1,
      failed: 0,
    });
    expect(reminderMocks.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'sent' }) }),
    );
  });

  it('devolve ao estado pendente quando a VK falha', async () => {
    reminderMocks.findOneAndUpdate.mockResolvedValueOnce(dueReminder).mockResolvedValueOnce(null);
    reminderMocks.updateOne.mockResolvedValue({ acknowledged: true });
    const vk = {
      getUserFirstName: vi.fn().mockResolvedValue('Bia'),
      createComment: vi.fn().mockRejectedValue(new Error('indisponível')),
    } as unknown as VkClient;

    await expect(processDueReminders(vk, Date.now() + 10_000)).resolves.toEqual({
      sent: 0,
      failed: 1,
    });
    expect(reminderMocks.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'pending' }) }),
    );
  });
});
