import { getCamisa7Count } from '../clients/camisa7.js';
import { VkApiError, type VkClient } from '../clients/vk.js';
import {
  cancelGameAlerts,
  listPendingGameAlerts,
  subscribeGameAlert,
} from '../football/game-alerts.js';
import {
  EXACT_SCORE_POINTS,
  getPredictionRanking,
  getPredictionStatus,
  OUTCOME_POINTS,
  registerPrediction,
} from '../football/predictions.js';
import { getFootballService, type FootballService } from '../football/service.js';
import type { FootballMatch } from '../football/types.js';
import { getCamisa7Trend, recordCamisa7Snapshot } from '../jobs/camisa7-snapshot.js';
import { log } from '../lib/logger.js';
import { formatShortDateKey, localYear, TIME_ZONE } from '../lib/time.js';
import { Reminder } from '../models/reminder.js';
import { buildActivityReply } from './activity.js';
import {
  antiGsdMessages,
  antiZicaMessages,
  gsdMessages,
  randomItem,
  tutorialMessage,
} from './content.js';
import { calculateReminderDate, type ParsedCommand } from './parser.js';
import {
  formatAgenda,
  formatBotafogoAgenda,
  formatBrasileiraoTable,
  formatLineups,
  formatNextGame,
  formatResult,
  formatRound,
  formatScoreLine,
  formatWhen,
  resolveAgendaWindow,
} from './sports.js';

const COMMUNITY_PAGE = 'https://vk.com/club228711116';
const TOPIC_BASE_URL = 'https://vk.com/topic-73670797_';
const UPEM_TOPIC_URL = 'https://vk.com/topic-73670797_41317973';
const PRIVATE_MESSAGE_DENIED_CODES = new Set([901, 902, 914]);
const FIRST_BOLAO_YEAR = 2026;
const LINEUP_LOOKAHEAD_MILLISECONDS = 3 * 60 * 60_000;
const SOURCE_UNAVAILABLE = Symbol('source-unavailable');

export interface CommandContext {
  topicId: number;
  commentId: number;
  userId: number;
  topicTitle: string;
  authorName?: string;
}

export interface ExecuteDependencies {
  vk: VkClient;
  football?: FootballService;
  getFanCount?: () => Promise<number>;
  random?: () => number;
  now?: () => Date;
}

export async function executeCommand(
  command: ParsedCommand,
  context: CommandContext,
  dependencies: ExecuteDependencies,
): Promise<void> {
  const { vk } = dependencies;
  const football = dependencies.football ?? getFootballService();
  const now = dependencies.now?.() ?? new Date();
  const operationBase = `topic:${context.topicId}:comment:${context.commentId}`;
  let cachedAuthorName = context.authorName;

  const mention = async (): Promise<string> => {
    cachedAuthorName ??= await vk.getUserFirstName(context.userId);
    return `[post${context.commentId}|${cachedAuthorName}]`;
  };
  const reply = async (message: string, suffix: string = command.kind): Promise<void> => {
    await vk.createComment(
      context.topicId,
      context.commentId,
      message,
      `${operationBase}:reply:${suffix}`,
    );
  };
  /** Resposta curta na mesma linha da menção. */
  const answer = async (body: string, suffix?: string): Promise<void> =>
    reply(`${await mention()}, ${body}`, suffix);
  /** Resposta com várias linhas abaixo da menção. */
  const answerBlock = async (body: string): Promise<void> => reply(`${await mention()},\n${body}`);
  /**
   * Consulta fontes externas sem retentativas longas: se falharem, o autor recebe um aviso
   * imediato em vez de uma resposta atrasada em horas. Erros da VK continuam sendo repetidos.
   */
  const fromSource = async <T>(load: () => Promise<T>): Promise<T | typeof SOURCE_UNAVAILABLE> => {
    try {
      return await load();
    } catch (error) {
      if (error instanceof VkApiError) throw error;
      log('warn', 'command.source_unavailable', { kind: command.kind, error });
      return SOURCE_UNAVAILABLE;
    }
  };
  const answerUnavailable = async (what = 'os dados de jogos'): Promise<void> =>
    answer(`⚠️ não consegui consultar ${what} agora. Tente novamente em alguns minutos.`);
  const nextMatch = async (): Promise<FootballMatch | null | typeof SOURCE_UNAVAILABLE> =>
    fromSource(() => football.getNextBotafogoMatch(now));

  switch (command.kind) {
    case 'camisa7': {
      const count = await fromSource(() => (dependencies.getFanCount ?? getCamisa7Count)());
      if (count === SOURCE_UNAVAILABLE) return answerUnavailable('o contador do Camisa 7');
      let trendLine = '';
      try {
        await recordCamisa7Snapshot(count, now);
        const trend = await getCamisa7Trend(now);
        if (trend) {
          const difference = count - trend.previousCount;
          const signal = difference > 0 ? '+' : difference < 0 ? '−' : '±';
          trendLine = `\n📈 ${signal}${formatNumber(Math.abs(difference))} desde ${formatShortDateKey(trend.sinceDateKey)}`;
        }
      } catch (error) {
        log('warn', 'camisa7.trend_failed', { error });
      }
      return answer(`Temos ${formatNumber(count)} sócios! ✈️${trendLine}`);
    }
    case 'quote':
      return answer(`${command.message} ✈️`);
    case 'gsd':
      return reply(randomItem(gsdMessages, dependencies.random));
    case 'antizica':
      return reply(randomItem(antiZicaMessages, dependencies.random));
    case 'mongol':
      return reply(randomItem(antiGsdMessages, dependencies.random));
    case 'upem':
      return answer(`Mais uma coisa que ninguém ouviu falar! PODE UPAR ${UPEM_TOPIC_URL} ✈️`);
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
        await answer(
          `Você tem que seguir a página ${COMMUNITY_PAGE} e enviar uma mensagem para ela antes de usar esse comando. ✈️`,
          'private-message-fallback',
        );
      }
      return;
    case 'reminder': {
      const remindAt = calculateReminderDate(command.amount, command.unit, now);
      const dedupeKey = `${context.topicId}:${context.commentId}`;
      const prefix = await mention();
      await Reminder.updateOne(
        { dedupeKey },
        {
          $setOnInsert: {
            dedupeKey,
            topicId: String(context.topicId),
            messageId: String(context.commentId),
            userId: String(context.userId),
            remindAt,
            message: `Reminder for ${cachedAuthorName ?? 'usuário'}`,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
          },
        },
        { upsert: true },
      );
      return reply(
        `${prefix}, Vou te marcar no tópico em ${command.amount} ${command.displayUnit} ✈️`,
      );
    }
    case 'invalid-reminder':
      return answer(
        'Desculpe, ocorreu um erro ao configurar o lembrete. Verifique se escreveu corretamente (ex.: !r 10 minutos) ou chame o Sarmet ✈️',
      );
    case 'tutorial':
      return reply(tutorialMessage);
    case 'stats':
    case 'top':
    case 'sequence':
    case 'retrospective':
    case 'records':
      return answerBlock(await buildActivityReply(command, vk, context.userId, now));
    case 'game': {
      const data = await fromSource(async () => {
        const match = await football.getNextBotafogoMatch(now);
        const broadcasts = match
          ? await football.getBroadcasts(match)
          : { broadcasts: [], source: null };
        return { match, broadcasts };
      });
      if (data === SOURCE_UNAVAILABLE) return answerUnavailable();
      return answerBlock(formatNextGame(data.match, data.broadcasts, now));
    }
    case 'agenda': {
      if (command.scope.type === 'botafogo') {
        const matches = await fromSource(() => football.getUpcomingBotafogoMatches());
        if (matches === SOURCE_UNAVAILABLE) return answerUnavailable();
        return answerBlock(formatBotafogoAgenda(matches, now));
      }
      const window = resolveAgendaWindow(command.scope, now);
      if (!window) return answer('essa data não existe. Use, por exemplo, !agenda 25/10 ✈️');
      const matches = await fromSource(() => football.getAgendaMatches(window.dates));
      if (matches === SOURCE_UNAVAILABLE) return answerUnavailable();
      return answerBlock(formatAgenda(matches, window, now));
    }
    case 'invalid-agenda':
      return answer(
        'use !agenda, !agenda amanhã, !agenda sábado, !agenda 25/10, !agenda semana ou !agenda botafogo ✈️',
      );
    case 'table': {
      const data = await fromSource(() => football.getBrasileirao());
      if (data === SOURCE_UNAVAILABLE) return answerUnavailable('a tabela do Brasileirão');
      return answerBlock(formatBrasileiraoTable(data));
    }
    case 'round': {
      const data = await fromSource(() => football.getBrasileirao());
      if (data === SOURCE_UNAVAILABLE) return answerUnavailable('a rodada do Brasileirão');
      return answerBlock(formatRound(data));
    }
    case 'result': {
      const data = await fromSource(async () => {
        const [last] = await football.getRecentBotafogoResults();
        const report = last ? await football.getMatchReport(last.id).catch(() => null) : null;
        return { last: last ?? null, report };
      });
      if (data === SOURCE_UNAVAILABLE) return answerUnavailable();
      return answerBlock(formatResult(data.last, data.report));
    }
    case 'lineup': {
      const data = await fromSource(async () => {
        const upcoming = await football.getNextBotafogoMatch(now);
        const soon =
          upcoming !== null &&
          (upcoming.status === 'live' ||
            new Date(upcoming.kickoffAt).getTime() - now.getTime() <=
              LINEUP_LOOKAHEAD_MILLISECONDS);
        const upcomingReport =
          upcoming && soon ? await football.getMatchReport(upcoming.id).catch(() => null) : null;
        const hasLineup = upcomingReport?.lineups.some(
          (lineup) => lineup.isBotafogo && lineup.starters.length >= 11,
        );
        if (hasLineup) return { upcoming, upcomingReport, last: null, lastReport: null };
        const [last] = await football.getRecentBotafogoResults();
        const lastReport = last ? await football.getMatchReport(last.id).catch(() => null) : null;
        return { upcoming, upcomingReport, last: last ?? null, lastReport };
      });
      if (data === SOURCE_UNAVAILABLE) return answerUnavailable();
      return answerBlock(formatLineups(data));
    }
    case 'prediction': {
      const match = await nextMatch();
      if (match === SOURCE_UNAVAILABLE) return answerUnavailable();
      const result = await registerPrediction(
        {
          userId: context.userId,
          topicId: context.topicId,
          commentId: context.commentId,
          home: command.home,
          away: command.away,
        },
        match,
        now,
      );
      switch (result.status) {
        case 'no-match':
          return answer('não encontrei o próximo jogo do Botafogo para registrar o palpite ✈️');
        case 'unsupported':
          return answerUnavailable('a fonte de resultados do bolão');
        case 'closed':
          return answer(
            `⛔ os palpites para ${formatScoreLine(result.match)} estão encerrados: o jogo já começou.`,
          );
        case 'registered':
        case 'updated': {
          const { match: target } = result;
          return answer(
            [
              `🎯 Palpite ${result.status === 'registered' ? 'registrado' : 'atualizado'}: ${target.homeTeam.name} ${command.home} x ${command.away} ${target.awayTeam.name}.`,
              `⏳ Vale até o início do jogo (${formatWhen(target, now, false)}).`,
              `💡 Placar exato vale ${EXACT_SCORE_POINTS} pontos; acertar o vencedor ou o empate vale ${OUTCOME_POINTS}.`,
            ].join('\n'),
          );
        }
      }
      return;
    }
    case 'prediction-status': {
      const match = await nextMatch();
      if (match === SOURCE_UNAVAILABLE) return answerUnavailable();
      const status = await getPredictionStatus(context.userId, match);
      if (!status.match) return answer('não encontrei o próximo jogo do Botafogo ✈️');
      const label = formatScoreLine(status.match);
      const total = `${status.totalForMatch} palpite(s) no total`;
      if (!status.prediction) {
        return answer(
          `você ainda não deu palpite para ${label} (${total}). Use !palpite 2x1, com os gols do mandante primeiro.`,
        );
      }
      return answer(
        `🎯 seu palpite: ${status.match.homeTeam.name} ${status.prediction.homeGoals} x ${status.prediction.awayGoals} ${status.match.awayTeam.name} (${total}). Para mudar, mande outro !palpite antes do jogo.`,
      );
    }
    case 'invalid-prediction':
      return answer('use !palpite 2x1, com os gols do mandante primeiro (até 20 gols por time) ✈️');
    case 'prediction-ranking': {
      const year = command.year ?? localYear(now);
      if (!Number.isInteger(year) || year < FIRST_BOLAO_YEAR || year > localYear(now)) {
        return answer(
          `o bolão começou em ${FIRST_BOLAO_YEAR}. Use !bolao ou !bolao ${localYear(now)} ✈️`,
        );
      }
      const ranking = await getPredictionRanking(year);
      if (ranking.length === 0) {
        return answerBlock(
          `ℹ️ Ainda não há palpites conferidos em ${year}. Mande o seu com !palpite 2x1.`,
        );
      }
      const top = ranking.slice(0, 10);
      const ownIndex = ranking.findIndex((entry) => entry.userId === String(context.userId));
      const names = await vk.getUserFirstNames(top.map((entry) => Number(entry.userId)));
      const medals = ['🥇', '🥈', '🥉'];
      const lines = [
        `🎯 Bolão do Pimpão — ${year}`,
        ...top.map(
          (entry, index) =>
            `${medals[index] ?? `${index + 1}.`} ${names.get(Number(entry.userId)) ?? 'Membro'} — ${entry.points} pts (${entry.exact} exato(s) em ${entry.predictions} palpite(s))`,
        ),
      ];
      const own = ranking[ownIndex];
      if (own && ownIndex >= top.length) {
        lines.push(`📌 Você: ${ownIndex + 1}º lugar, ${own.points} pts`);
      }
      lines.push(
        `💡 Placar exato: ${EXACT_SCORE_POINTS} pts · vencedor ou empate: ${OUTCOME_POINTS} pt`,
      );
      return answerBlock(lines.join('\n'));
    }
    case 'game-alert': {
      const match = await nextMatch();
      if (match === SOURCE_UNAVAILABLE) return answerUnavailable();
      const result = await subscribeGameAlert(
        { userId: context.userId, topicId: context.topicId, commentId: context.commentId },
        match,
        now,
      );
      switch (result.status) {
        case 'no-match':
          return answer('não encontrei o próximo jogo do Botafogo ✈️');
        case 'started':
          return answer(`${formatScoreLine(result.match)} já começou ✈️`);
        case 'exists':
          return answer(`🔔 você já está na lista do aviso de ${formatScoreLine(result.match)} ✈️`);
        case 'created': {
          const adjust = result.match.time
            ? ''
            : ' Quando o horário for confirmado, ajusto o aviso.';
          return answer(
            `🔔 combinado! Vou te marcar 30 min antes de ${formatScoreLine(result.match)} (${formatWhen(result.match, now, false)}).${adjust} Para cancelar: !avisar cancelar`,
          );
        }
      }
      return;
    }
    case 'cancel-game-alert': {
      const cancelled = await cancelGameAlerts(context.userId);
      return answer(
        cancelled > 0 ? '🔕 aviso de jogo cancelado ✈️' : 'você não tinha avisos de jogo ativos ✈️',
      );
    }
    case 'reminders': {
      const [reminders, alerts] = await Promise.all([
        Reminder.find({
          userId: String(context.userId),
          $or: [{ status: { $in: ['pending', 'processing'] } }, { status: { $exists: false } }],
        })
          .sort({ remindAt: 1 })
          .limit(11)
          .lean(),
        listPendingGameAlerts(context.userId),
      ]);
      const visible = reminders.slice(0, 10);
      if (visible.length === 0 && alerts.length === 0) {
        return answer('você não tem lembretes pendentes ✈️');
      }
      const lines = [
        ...visible.map(
          (reminder, index) =>
            `${index + 1}. ${formatReminderDate(reminder.remindAt, now)} — ${TOPIC_BASE_URL}${reminder.topicId}?post=${reminder.messageId}`,
        ),
        ...alerts.map(
          (alert) =>
            `⚽ ${formatReminderDate(new Date(alert.kickoffAt.getTime() - 30 * 60_000), now)} — aviso de ${alert.homeTeam} x ${alert.awayTeam}`,
        ),
      ];
      if (reminders.length > visible.length) lines.push('...e mais lembretes pendentes.');
      return answer(`seus lembretes pendentes:\n${lines.join('\n')}`);
    }
  }
}

function formatReminderDate(remindAt: Date, now: Date): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: localYear(remindAt) === localYear(now) ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(remindAt);
}

function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}
