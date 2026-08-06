import { getCamisa7Count } from '../clients/camisa7.js';
import { getBrasileiraoCompetition, type BrasileiraoCompetition } from '../clients/brasileirao.js';
import {
  getBotafogoSchedule,
  getDailyFootballSchedule,
  type FootballSchedule,
} from '../clients/football-schedule.js';
import { VkApiError, type VkClient } from '../clients/vk.js';
import {
  formatDateKey,
  getCommunityRecordCandidates,
  getCommunityRetrospective,
} from '../activity/community-stats.js';
import { Reminder } from '../models/reminder.js';
import {
  getActiveDates,
  getActivityRanking,
  getActivityStats,
  longestActiveSequence,
} from '../activity/stats.js';
import {
  antiGsdMessages,
  antiZicaMessages,
  gsdMessages,
  randomItem,
  tutorialMessage,
} from './content.js';
import { calculateReminderDate, type ParsedCommand } from './parser.js';
import { formatAgenda, formatBotafogoGame, formatBrasileiraoTable } from './sports.js';

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
  getBrasileirao?: () => Promise<BrasileiraoCompetition>;
  getBotafogoSchedule?: () => Promise<FootballSchedule>;
  getDailyFootballSchedule?: () => Promise<FootballSchedule>;
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
    if (
      command.kind === 'top' ||
      command.kind === 'sequence' ||
      command.kind === 'retrospective' ||
      command.kind === 'records'
    ) {
      message = formatActivityReply(command.kind, message);
    }
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
      return;
    case 'stats': {
      const now = dependencies.now?.() ?? new Date();
      const year = resolveYear(command.year, now);
      if (!isAvailableActivityYear(year, now)) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ dados de atividade para ${year}. A cobertura disponÃ­vel comeÃ§a em 2026 e vai atÃ© o ano atual âœˆï¸`,
        );
        return;
      }
      const stats = await getActivityStats(vk.groupId, context.userId, year);
      await reply(
        `[post${context.commentId}|${await authorName()}],\n${formatActivityStats(stats, year)}`,
      );
      return;
    }
    case 'top': {
      const now = dependencies.now?.() ?? new Date();
      const year = resolveYear(command.year, now);
      if (!isAvailableActivityYear(year, now)) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ dados de atividade para ${year}. A cobertura disponÃ­vel comeÃ§a em 2026 e vai atÃ© o ano atual âœˆï¸`,
        );
        return;
      }
      if (!Number.isInteger(command.limit) || command.limit < 1 || command.limit > 20) {
        await reply(
          `[post${context.commentId}|${await authorName()}], use !top, !top5 ou !top 5 2026 âœˆï¸`,
        );
        return;
      }
      const candidates = await getActivityRanking(vk.groupId, year, command.limit);
      const memberships = await vk.getUserMemberships(
        candidates.map((entry) => Number(entry.userId)),
      );
      const visible = candidates
        .filter((entry) => memberships.get(Number(entry.userId)) === true)
        .slice(0, command.limit);
      if (visible.length === 0) {
        await reply(
          `[post${context.commentId}|${await authorName()}], ainda nÃ£o hÃ¡ dados suficientes para o ranking de ${year} âœˆï¸`,
        );
        return;
      }
      const names = await Promise.all(
        visible.map((entry) => vk.getUserFirstName(Number(entry.userId))),
      );
      const lines = visible.map(
        (entry, index) =>
          `${index + 1}. ${names[index]} â€” ${entry.score} pts | ${entry.comments} comentÃ¡rios | ${entry.activeDays} dias ativos`,
      );
      await reply(
        `[post${context.commentId}|${await authorName()}], ranking de atividade de ${year}:\n${lines.join('\n')}\nPontuaÃ§Ã£o: atÃ© 20 comentÃ¡rios e 5 tÃ³picos por dia.`,
      );
      return;
    }
    case 'sequence': {
      const now = dependencies.now?.() ?? new Date();
      const year = resolveYear(command.year, now);
      if (!isAvailableActivityYear(year, now)) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ dados de atividade para ${year}. A cobertura disponÃ­vel comeÃ§a em 2026 e vai atÃ© o ano atual âœˆï¸`,
        );
        return;
      }
      const sequence = longestActiveSequence(
        await getActiveDates(vk.groupId, context.userId, year),
      );
      await reply(
        `[post${context.commentId}|${await authorName()}], sua maior sequÃªncia de dias ativos em ${year} foi de ${sequence} dia(s) âœˆï¸`,
      );
      return;
    }
    case 'retrospective': {
      const now = dependencies.now?.() ?? new Date();
      const year = resolveYear(command.year, now);
      if (!isAvailableActivityYear(year, now)) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ dados de atividade para ${year}. A cobertura disponÃ­vel comeÃ§a em 2026 e vai atÃ© o ano atual âœˆï¸`,
        );
        return;
      }
      const retrospective = await getCommunityRetrospective(vk.groupId, year);
      if (retrospective.comments === 0 && retrospective.topics === 0) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ atividade registrada em ${year} âœˆï¸`,
        );
        return;
      }
      const busiest = retrospective.busiestDay
        ? `${formatDateKey(retrospective.busiestDay.dateKey)} (${retrospective.busiestDay.events} atividades)`
        : '—';
      await reply(
        `[post${context.commentId}|${await authorName()}],\nretrospectiva da comunidade em ${year}:\nparticipantes: ${retrospective.participants}\ncomentÃ¡rios: ${retrospective.comments}\ntÃ³picos criados: ${retrospective.topics}\ndias ativos: ${retrospective.activeDays}\ncomandos: ${retrospective.commands}\ndia mais movimentado: ${busiest}`,
      );
      return;
    }
    case 'records': {
      const now = dependencies.now?.() ?? new Date();
      const year = resolveYear(command.year, now);
      if (!isAvailableActivityYear(year, now)) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ dados de atividade para ${year}. A cobertura disponÃ­vel comeÃ§a em 2026 e vai atÃ© o ano atual âœˆï¸`,
        );
        return;
      }
      const candidates = await getCommunityRecordCandidates(vk.groupId, year);
      const memberships = await vk.getUserMemberships(
        candidates.map((entry) => Number(entry.userId)),
      );
      const members = candidates.filter((entry) => memberships.get(Number(entry.userId)) === true);
      const mostComments = members[0];
      const mostTopics = [...members].sort(
        (a, b) => b.topics - a.topics || b.comments - a.comments,
      )[0];
      const longestSequence = members
        .map((entry) => ({ entry, sequence: longestActiveSequence(entry.dateKeys) }))
        .sort((a, b) => b.sequence - a.sequence || b.entry.comments - a.entry.comments)[0];
      if (!mostComments || !mostTopics || !longestSequence) {
        await reply(
          `[post${context.commentId}|${await authorName()}], nÃ£o hÃ¡ dados suficientes para os recordes de ${year} âœˆï¸`,
        );
        return;
      }
      const ids = [mostComments.userId, mostTopics.userId, longestSequence.entry.userId];
      const names = await Promise.all(ids.map((id) => vk.getUserFirstName(Number(id))));
      const [commentsName, topicsName, sequenceName] = names;
      await reply(
        `[post${context.commentId}|${await authorName()}],\nrecordes de atividade em ${year}:\nmais comentÃ¡rios: ${commentsName} (${mostComments.comments})\nmais tÃ³picos criados: ${topicsName} (${mostTopics.topics})\nmaior sequÃªncia: ${sequenceName} (${longestSequence.sequence} dias)`,
      );
      return;
    }
    case 'game': {
      const data = await (dependencies.getBotafogoSchedule ?? getBotafogoSchedule)();
      await reply(
        `[post${context.commentId}|${await authorName()}],\n${formatBotafogoGame(data, dependencies.now?.())}`,
      );
      return;
    }
    case 'agenda': {
      const data =
        command.scope === 'botafogo'
          ? await (dependencies.getBotafogoSchedule ?? getBotafogoSchedule)()
          : await (dependencies.getDailyFootballSchedule ?? getDailyFootballSchedule)();
      await reply(
        `[post${context.commentId}|${await authorName()}],\n${formatAgenda(data, command.scope, dependencies.now?.())}`,
      );
      return;
    }
    case 'invalid-agenda':
      await reply(
        `[post${context.commentId}|${await authorName()}], use !agenda, !agenda amanhã ou !agenda botafogo ✈️`,
      );
      return;
    case 'table': {
      const data = await (dependencies.getBrasileirao ?? getBrasileiraoCompetition)();
      await reply(
        `[post${context.commentId}|${await authorName()}],\n${formatBrasileiraoTable(data)}`,
      );
      return;
    }
    case 'reminders': {
      const now = dependencies.now?.() ?? new Date();
      const reminders = await Reminder.find({
        userId: String(context.userId),
        $or: [{ status: { $in: ['pending', 'processing'] } }, { status: { $exists: false } }],
      })
        .sort({ remindAt: 1 })
        .limit(11)
        .lean();
      const visible = reminders.slice(0, 10);
      if (visible.length === 0) {
        await reply(
          `[post${context.commentId}|${await authorName()}], você não tem lembretes pendentes ✈️`,
        );
        return;
      }
      const lines = visible.map(
        (reminder, index) =>
          `${index + 1}. ${formatReminderDate(reminder.remindAt, now)} — ${TOPIC_BASE_URL}${reminder.topicId}?post=${reminder.messageId}`,
      );
      if (reminders.length > visible.length) lines.push('...e mais lembretes pendentes.');
      await reply(
        `[post${context.commentId}|${await authorName()}], seus lembretes pendentes:\n${lines.join('\n')}`,
      );
      return;
    }
  }
}

function resolveYear(year: number | undefined, now = new Date()): number {
  return (
    year ??
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(
        now,
      ),
    )
  );
}

function isAvailableActivityYear(year: number, now: Date): boolean {
  const currentYear = resolveYear(undefined, now);
  return Number.isInteger(year) && year >= 2026 && year <= currentYear;
}

function formatLegacyActivityStats(
  stats: Awaited<ReturnType<typeof getActivityStats>>,
  year: number,
): string {
  if (stats.comments === 0 && stats.topics === 0) return `nÃ£o encontrei atividade sua em ${year}.`;
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
  });
  return [
    `suas estatÃ­sticas de ${year}:`,
    `comentÃ¡rios: ${stats.comments}`,
    `tÃ³picos criados: ${stats.topics}`,
    `dias ativos: ${stats.activeDays}`,
    `comandos: ${stats.commands}`,
    `primeira atividade: ${stats.firstActivity ? formatter.format(stats.firstActivity) : '—'}`,
    `Ãºltima atividade: ${stats.lastActivity ? formatter.format(stats.lastActivity) : '—'}`,
  ].join('\n');
}

void formatLegacyActivityStats;

function formatActivityStats(
  stats: Awaited<ReturnType<typeof getActivityStats>>,
  year: number,
): string {
  if (stats.comments === 0 && stats.topics === 0) {
    return `\u{1F4CA} N\u00e3o encontrei atividade sua em ${year}.`;
  }
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
  });
  return [
    `\u{1F4CA} Suas estat\u00edsticas de ${year}:`,
    `\u{1F4AC} Coment\u00e1rios: ${stats.comments}`,
    `\u{1F4DD} T\u00f3picos criados: ${stats.topics}`,
    `\u{1F4C5} Dias ativos: ${stats.activeDays}`,
    `\u{1F916} Comandos: ${stats.commands}`,
    `\u{1F680} Primeira atividade: ${stats.firstActivity ? formatter.format(stats.firstActivity) : '\u2014'}`,
    `\u{1F3C1} \u00daltima atividade: ${stats.lastActivity ? formatter.format(stats.lastActivity) : '\u2014'}`,
  ].join('\\n');
}

function formatActivityReply(
  kind: 'top' | 'sequence' | 'retrospective' | 'records',
  message: string,
): string {
  const prefixEnd = message.indexOf('],') + 2;
  if (prefixEnd < 2) return message;
  const prefix = message.slice(0, prefixEnd);
  const body = message.slice(prefixEnd).replace(/^\s*/u, '');
  const year = body.match(/\b\d{4}\b/u)?.[0] ?? '';

  if (kind === 'sequence') {
    if (!body.includes('foi de')) return message;
    const sequence = body.match(/foi de (\d+) dia/u)?.[1] ?? '0';
    return `${prefix}\n\u{1F525} Sua maior sequ\u00eancia de dias ativos em ${year}: ${sequence} dia(s).`;
  }

  if (kind === 'top') {
    const rankLines = body.split('\n').filter((line) => /^\d+\./u.test(line));
    if (rankLines.length === 0) return message;
    const entries = rankLines.map((line) => {
      const match =
        /^(\d+)\.\s+(.+?)\s+\S+\s+(\d+)\s+pts\s+\|\s+(\d+)\s+\S+\s+\|\s+(\d+)\s+dias/u.exec(line);
      return match
        ? `\u{1F3C5} ${match[1]}. ${match[2]} — ${match[3]} pts | ${match[4]} coment\u00e1rios | ${match[5]} dias ativos`
        : `\u{1F3C5} ${line}`;
    });
    return `${prefix}\n\u{1F3C6} Ranking de atividade de ${year}:\n${entries.join('\n')}\n\u{1F4A1} Pontua\u00e7\u00e3o limitada por dia para reduzir spam.`;
  }

  if (kind === 'retrospective') {
    if (!body.includes('retrospectiva da comunidade')) return message;
    const values = [...body.matchAll(/:\s*(\d+)/gu)].map((match) => match[1]);
    const busiestDate = body.match(/\b\d{2}\/\d{2}\/\d{4}\b/u)?.[0] ?? '—';
    return [
      prefix,
      `\u{1F4CA} Retrospectiva da comunidade em ${year}:`,
      `\u{1F465} Participantes: ${values[0] ?? 0}`,
      `\u{1F4AC} Coment\u00e1rios: ${values[1] ?? 0}`,
      `\u{1F4DD} T\u00f3picos criados: ${values[2] ?? 0}`,
      `\u{1F4C5} Dias ativos: ${values[3] ?? 0}`,
      `\u{1F916} Comandos: ${values[4] ?? 0}`,
      `\u{1F525} Dia mais movimentado: ${busiestDate} (${values[5] ?? 0} atividades)`,
    ].join('\n');
  }

  if (!body.includes('recordes de atividade')) return message;
  const records = body
    .split('\n')
    .slice(1)
    .map((line) => /:\s*(.+?)\s+\((\d+)\)/u.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  return [
    prefix,
    `\u{1F3C6} Recordes de atividade em ${year}:`,
    `\u{1F4AC} Mais coment\u00e1rios: ${records[0]?.[1] ?? '—'} (${records[0]?.[2] ?? 0})`,
    `\u{1F4DD} Mais t\u00f3picos criados: ${records[1]?.[1] ?? '—'} (${records[1]?.[2] ?? 0})`,
    `\u{1F525} Maior sequ\u00eancia: ${records[2]?.[1] ?? '—'} (${records[2]?.[2] ?? 0} dias)`,
  ].join('\n');
}

function formatReminderDate(remindAt: Date, now: Date): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: remindAt.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(remindAt);
}
