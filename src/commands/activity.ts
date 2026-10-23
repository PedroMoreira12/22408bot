import {
  formatDateKey,
  getCommunityRecordCandidates,
  getCommunityRetrospective,
} from '../activity/community-stats.js';
import {
  getActiveDates,
  getActivityRanking,
  getActivityStats,
  longestActiveSequence,
} from '../activity/stats.js';
import type { VkClient } from '../clients/vk.js';
import { localYear, TIME_ZONE } from '../lib/time.js';

export const FIRST_ACTIVITY_YEAR = 2026;

type ActivityCommand =
  | { kind: 'stats'; year?: number }
  | { kind: 'top'; limit: number; year?: number }
  | { kind: 'sequence'; year?: number }
  | { kind: 'retrospective'; year?: number }
  | { kind: 'records'; year?: number };

/** Monta o corpo das respostas de estatísticas; o executor acrescenta a menção ao autor. */
export async function buildActivityReply(
  command: ActivityCommand,
  vk: Pick<VkClient, 'groupId' | 'getUserMemberships' | 'getUserFirstNames'>,
  userId: number,
  now: Date,
): Promise<string> {
  const year = command.year ?? localYear(now);
  if (!isAvailableYear(year, now)) {
    return `⚠️ Não há dados de atividade para ${Number.isNaN(year) ? 'esse ano' : year}. A cobertura disponível começa em ${FIRST_ACTIVITY_YEAR} e vai até o ano atual.`;
  }

  switch (command.kind) {
    case 'stats': {
      const [stats, dates] = await Promise.all([
        getActivityStats(vk.groupId, userId, year),
        getActiveDates(vk.groupId, userId, year),
      ]);
      if (stats.comments === 0 && stats.topics === 0) {
        return `📊 Não encontrei atividade sua em ${year}.`;
      }
      const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIME_ZONE,
        dateStyle: 'short',
      });
      return [
        `📊 Suas estatísticas de ${year}:`,
        `💬 Comentários: ${stats.comments}`,
        `📝 Tópicos criados: ${stats.topics}`,
        `📅 Dias ativos: ${stats.activeDays}`,
        `🤖 Comandos: ${stats.commands}`,
        `🚀 Primeira atividade: ${stats.firstActivity ? formatter.format(stats.firstActivity) : '—'}`,
        `🔥 Maior sequência: ${longestActiveSequence(dates)} dia(s)`,
      ].join('\n');
    }
    case 'top': {
      if (!Number.isInteger(command.limit) || command.limit < 1 || command.limit > 20) {
        return 'ℹ️ Use !top, !top5 ou !top 5 2026.';
      }
      const candidates = await getActivityRanking(vk.groupId, year, command.limit);
      const memberships = await vk.getUserMemberships(
        candidates.map((entry) => Number(entry.userId)),
      );
      const visible = candidates
        .filter((entry) => memberships.get(Number(entry.userId)) === true)
        .slice(0, command.limit);
      if (visible.length === 0)
        return `ℹ️ Ainda não há dados suficientes para o ranking de ${year}.`;
      const names = await vk.getUserFirstNames(visible.map((entry) => Number(entry.userId)));
      return [
        `🏆 Ranking de atividade de ${year}:`,
        ...visible.map(
          (entry, index) =>
            `🏅 ${index + 1}. ${names.get(Number(entry.userId)) ?? 'Membro'} — ${entry.score} pts | ${entry.comments} comentários | ${entry.activeDays} dias ativos`,
        ),
        '💡 Pontuação limitada por dia para reduzir spam.',
      ].join('\n');
    }
    case 'sequence': {
      const sequence = longestActiveSequence(await getActiveDates(vk.groupId, userId, year));
      return `🔥 Sua maior sequência de dias ativos em ${year}: ${sequence} dia(s).`;
    }
    case 'retrospective': {
      const retrospective = await getCommunityRetrospective(vk.groupId, year);
      if (retrospective.comments === 0 && retrospective.topics === 0) {
        return `ℹ️ Não há atividade registrada em ${year}.`;
      }
      const busiest = retrospective.busiestDay
        ? `${formatDateKey(retrospective.busiestDay.dateKey)} (${retrospective.busiestDay.events} atividades)`
        : '—';
      return [
        `📊 Retrospectiva da comunidade em ${year}:`,
        `👥 Participantes: ${retrospective.participants}`,
        `💬 Comentários: ${retrospective.comments}`,
        `📝 Tópicos criados: ${retrospective.topics}`,
        `📅 Dias ativos: ${retrospective.activeDays}`,
        `🤖 Comandos: ${retrospective.commands}`,
        `🔥 Dia mais movimentado: ${busiest}`,
      ].join('\n');
    }
    case 'records': {
      const candidates = await getCommunityRecordCandidates(vk.groupId, year);
      const memberships = await vk.getUserMemberships(
        candidates.map((entry) => Number(entry.userId)),
      );
      const members = candidates.filter((entry) => memberships.get(Number(entry.userId)) === true);
      const mostComments = members[0];
      const mostTopics = [...members].sort(
        (left, right) => right.topics - left.topics || right.comments - left.comments,
      )[0];
      const longest = members
        .map((entry) => ({ entry, sequence: longestActiveSequence(entry.dateKeys) }))
        .sort(
          (left, right) =>
            right.sequence - left.sequence || right.entry.comments - left.entry.comments,
        )[0];
      if (!mostComments || !mostTopics || !longest) {
        return `ℹ️ Não há dados suficientes para os recordes de ${year}.`;
      }
      const names = await vk.getUserFirstNames(
        [mostComments.userId, mostTopics.userId, longest.entry.userId].map(Number),
      );
      const name = (userId: string): string => names.get(Number(userId)) ?? 'Membro';
      return [
        `🏆 Recordes de atividade em ${year}:`,
        `💬 Mais comentários: ${name(mostComments.userId)} (${mostComments.comments})`,
        `📝 Mais tópicos criados: ${name(mostTopics.userId)} (${mostTopics.topics})`,
        `🔥 Maior sequência: ${name(longest.entry.userId)} (${longest.sequence} dias)`,
      ].join('\n');
    }
  }
}

function isAvailableYear(year: number, now: Date): boolean {
  return Number.isInteger(year) && year >= FIRST_ACTIVITY_YEAR && year <= localYear(now);
}
