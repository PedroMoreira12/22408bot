import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  exists: vi.fn(),
}));
const executeMock = vi.hoisted(() => vi.fn());
vi.mock('../src/models/command-job.js', () => ({ CommandJob: commandMocks }));
vi.mock('../src/commands/execute.js', () => ({ executeCommand: executeMock }));

import type { VkClient } from '../src/clients/vk.js';
import { commandCooldown } from '../src/commands/cooldown.js';
import { parseCommand } from '../src/commands/parser.js';
import { processPendingCommands } from '../src/jobs/process-commands.js';

const job = (text: string, attempts = 1) => ({
  _id: `job-${text}`,
  topicId: '7',
  commentId: '12',
  userId: '2',
  topicTitle: 'Jogo',
  text,
  attempts,
});

describe('processPendingCommands', () => {
  const vk = {} as VkClient;

  beforeEach(() => {
    vi.clearAllMocks();
    commandMocks.updateOne.mockResolvedValue({ acknowledged: true });
    executeMock.mockResolvedValue(undefined);
  });

  it('executa e grava a chave de cooldown ao concluir', async () => {
    commandMocks.findOneAndUpdate.mockResolvedValueOnce(job('!jogo')).mockResolvedValueOnce(null);
    commandMocks.exists.mockResolvedValue(null);

    await expect(processPendingCommands(vk, Date.now() + 10_000)).resolves.toEqual({
      completed: 1,
      skipped: 0,
      failed: 0,
    });
    expect(executeMock).toHaveBeenCalledOnce();
    expect(commandMocks.updateOne).toHaveBeenCalledWith(
      { _id: 'job-!jogo', status: 'processing' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'completed', commandKey: 'game' }),
      }),
    );
  });

  it('ignora consulta repetida do mesmo autor dentro do cooldown', async () => {
    commandMocks.findOneAndUpdate.mockResolvedValueOnce(job('!tabela')).mockResolvedValueOnce(null);
    commandMocks.exists.mockResolvedValue({ _id: 'anterior' });

    await expect(processPendingCommands(vk, Date.now() + 10_000)).resolves.toEqual({
      completed: 0,
      skipped: 1,
      failed: 0,
    });
    expect(executeMock).not.toHaveBeenCalled();
    expect(commandMocks.exists).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '2',
        commandKey: 'table',
        skippedReason: { $exists: false },
      }),
    );
    expect(commandMocks.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ skippedReason: 'cooldown' }),
      }),
    );
  });

  it('não aplica cooldown a palpites e marca falha definitiva para expirar', async () => {
    commandMocks.findOneAndUpdate
      .mockResolvedValueOnce(job('!palpite 2x1', 10))
      .mockResolvedValueOnce(null);
    executeMock.mockRejectedValue(new Error('mongo fora'));

    await expect(processPendingCommands(vk, Date.now() + 10_000)).resolves.toEqual({
      completed: 0,
      skipped: 0,
      failed: 1,
    });
    expect(commandMocks.exists).not.toHaveBeenCalled();
    expect(commandMocks.updateOne).toHaveBeenCalledWith(
      { _id: 'job-!palpite 2x1' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'failed', failedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('commandCooldown', () => {
  it.each([
    ['!agenda', 'agenda:today', 60_000],
    ['!agenda sábado', 'agenda:weekday-6', 60_000],
    ['!top5 2026', 'top:5:2026', 180_000],
    ['!camisa7', 'camisa7', 60_000],
  ])('%s usa a chave %s', (text, key, milliseconds) => {
    const command = parseCommand(text);
    expect(command && commandCooldown(command)).toEqual({ key, milliseconds });
  });

  it.each(['!gsd', '!c oi', '!r 1 dia', '!palpite 1x0', '!avisar'])(
    '%s não tem cooldown',
    (text) => {
      const command = parseCommand(text);
      expect(command && commandCooldown(command)).toBeNull();
    },
  );
});
