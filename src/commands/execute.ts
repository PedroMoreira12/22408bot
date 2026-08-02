import { getCamisa7Count } from '../clients/camisa7.js';
import { VkApiError, type VkClient } from '../clients/vk.js';
import { Reminder } from '../models/reminder.js';
import {
  antiGsdMessages,
  antiZicaMessages,
  gsdMessages,
  randomItem,
  tutorialMessage,
} from './content.js';
import { calculateReminderDate, type ParsedCommand } from './parser.js';

const COMMUNITY_PAGE = 'https://vk.com/club228711116';
const TOPIC_BASE_URL = 'https://vk.com/topic-73670797_';
const UPEM_TOPIC_URL = 'https://vk.com/topic-73670797_41317973';
const PRIVATE_MESSAGE_DENIED_CODES = new Set([901, 902, 914]);

export interface CommandContext {
  topicId: number;
  commentId: number;
  userId: number;
  topicTitle: string;
  authorName?: string;
}

export interface ExecuteDependencies {
  vk: VkClient;
  getFanCount?: typeof getCamisa7Count;
  random?: () => number;
  now?: () => Date;
}

export async function executeCommand(
  command: ParsedCommand,
  context: CommandContext,
  dependencies: ExecuteDependencies,
): Promise<void> {
  const { vk } = dependencies;
  const operationBase = `topic:${context.topicId}:comment:${context.commentId}`;
  let cachedAuthorName = context.authorName;

  const authorName = async (): Promise<string> => {
    cachedAuthorName ??= await vk.getUserFirstName(context.userId);
    return cachedAuthorName;
  };
  const reply = async (message: string, suffix: string = command.kind): Promise<void> => {
    await vk.createComment(
      context.topicId,
      context.commentId,
      message,
      `${operationBase}:reply:${suffix}`,
    );
  };

  switch (command.kind) {
    case 'camisa7': {
      const fanCount = await (dependencies.getFanCount ?? getCamisa7Count)();
      await reply(`[post${context.commentId}|${await authorName()}], Temos ${fanCount} sócios! ✈️`);
      return;
    }
    case 'quote':
      await reply(`[post${context.commentId}|${await authorName()}], ${command.message} ✈️`);
      return;
    case 'gsd':
      await reply(randomItem(gsdMessages, dependencies.random));
      return;
    case 'antizica':
      await reply(randomItem(antiZicaMessages, dependencies.random));
      return;
    case 'mongol':
      await reply(randomItem(antiGsdMessages, dependencies.random));
      return;
    case 'upem':
      await reply(
        `[post${context.commentId}|${await authorName()}], Mais uma coisa que ninguém ouviu falar! PODE UPAR ${UPEM_TOPIC_URL} ✈️`,
      );
      return;
    case 'private-message':
      try {
        await vk.sendMessage(
          context.userId,
          `Segue o link do tópico ${context.topicTitle}: ${TOPIC_BASE_URL}${context.topicId}`,
          `${operationBase}:private-message`,
        );
      } catch (error) {
        if (!(error instanceof VkApiError) || !PRIVATE_MESSAGE_DENIED_CODES.has(error.code))
          throw error;
        await reply(
          `[post${context.commentId}|${await authorName()}], Você tem que seguir a página ${COMMUNITY_PAGE} e enviar uma mensagem para ela antes de usar esse comando. ✈️`,
          'private-message-fallback',
        );
      }
      return;
    case 'reminder': {
      const remindAt = calculateReminderDate(command.amount, command.unit, dependencies.now?.());
      const dedupeKey = `${context.topicId}:${context.commentId}`;
      await Reminder.updateOne(
        { dedupeKey },
        {
          $setOnInsert: {
            dedupeKey,
            topicId: String(context.topicId),
            messageId: String(context.commentId),
            userId: String(context.userId),
            remindAt,
            message: `Reminder for ${await authorName()}`,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
          },
        },
        { upsert: true },
      );
      await reply(
        `[post${context.commentId}|${await authorName()}], Vou te marcar no tópico em ${command.amount} ${command.displayUnit} ✈️`,
      );
      return;
    }
    case 'invalid-reminder':
      await reply(
        `[post${context.commentId}|${await authorName()}], Desculpe, ocorreu um erro ao configurar o lembrete. Verifique se escreveu corretamente ou chame o Sarmet ✈️`,
      );
      return;
    case 'tutorial':
      await reply(tutorialMessage);
  }
}
