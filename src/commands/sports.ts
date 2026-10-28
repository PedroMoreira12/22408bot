import type { BrasileiraoCompetition, BrasileiraoTableEntry } from '../clients/brasileirao.js';
import { BROADCAST_KIND_LABELS, groupBroadcasts } from '../football/channels.js';
import type { BroadcastInfo } from '../football/service.js';
import type { FootballMatch, MatchGoal, MatchReport, TeamLineup } from '../football/types.js';
import { compareMatches, involvesBotafogo } from '../football/types.js';
import {
  addDays,
  daysBetween,
  formatCountdown,
  formatShortDateKey,
  isValidDateKey,
  localDateKey,
  weekdayName,
  weekdayOf,
} from '../lib/time.js';
import type { AgendaScope } from './parser.js';

export const MAX_MESSAGE_LENGTH = 3_500;
const BROADCAST_SOURCE_LABELS: Record<NonNullable<BroadcastInfo['source']>, string> = {
  futebolnatv: 'futebolnatv.com.br',
  ge: 'ge.globo.com',
  espn: 'ESPN',
};

export interface AgendaWindow {
  dates: string[];
  label: string;
}

/** Converte o escopo do comando em datas de São Paulo; `null` quando a data não existe. */
export function resolveAgendaWindow(scope: AgendaScope, now = new Date()): AgendaWindow | null {
  const today = localDateKey(now);
  switch (scope.type) {
    case 'today':
      return { dates: [today], label: `hoje (${formatShortDateKey(today)})` };
    case 'tomorrow': {
      const tomorrow = addDays(today, 1);
      return { dates: [tomorrow], label: `amanhã (${formatShortDateKey(tomorrow)})` };
    }
    case 'week':
      return {
        dates: Array.from({ length: 7 }, (_, index) => addDays(today, index)),
        label: 'os próximos 7 dias',
      };
    case 'weekday': {
      const date = addDays(today, (scope.weekday - weekdayOf(today) + 7) % 7);
      return { dates: [date], label: `${weekdayName(date)} (${formatShortDateKey(date)})` };
    }
    case 'date': {
      const currentYear = Number(today.slice(0, 4));
      let year = scope.year ?? currentYear;
      let date = dateKey(year, scope.month, scope.day);
      // Sem ano explícito, datas que já passaram há mais de dois meses se referem ao ano seguinte.
      if (scope.year === undefined && daysBetween(date, today) > 60) {
        year += 1;
        date = dateKey(year, scope.month, scope.day);
      }
      if (!isValidDateKey(date)) return null;
      const label = `${weekdayName(date)} (${formatShortDateKey(date)}${year === currentYear ? '' : `/${year}`})`;
      return { dates: [date], label };
    }
    case 'botafogo':
      return null;
  }
}

export function formatNextGame(
  match: FootballMatch | null,
  broadcasts: BroadcastInfo,
  now = new Date(),
): string {
  if (!match) return 'Não encontrei um próximo jogo do Botafogo confirmado.';

  const live = match.status === 'live';
  const lines = [
    live
      ? `🔴 Botafogo em campo — ${match.competition}`
      : `⚽ Próximo jogo do Botafogo — ${match.competition}`,
    `⭐ ${formatScoreLine(match)}${live && match.liveDetail ? ` — ${match.liveDetail}` : ''}`,
  ];
  if (!live) {
    const countdown = match.time ? formatCountdown(now, new Date(match.kickoffAt)) : null;
    lines.push(`📅 ${formatWhen(match, now)}${countdown ? ` (faltam ${countdown})` : ''}`);
  }
  if (match.venue) lines.push(`🏟️ ${match.venue}`);
  if (match.phase) lines.push(`🏆 ${match.phase}`);
  lines.push(...formatBroadcastLines(broadcasts));
  return lines.join('\n');
}

export function formatBroadcastLines(info: BroadcastInfo): string[] {
  if (info.broadcasts.length === 0) return ['📺 Onde assistir: transmissão ainda não informada'];
  const lines = groupBroadcasts(info.broadcasts).map(
    ([kind, names]) =>
      `${kind.includes('streaming') ? '📱' : '📺'} ${BROADCAST_KIND_LABELS[kind]}: ${formatNaturalList(names)}`,
  );
  if (info.source) lines.push(`📡 Fonte dos canais: ${BROADCAST_SOURCE_LABELS[info.source]}`);
  return lines;
}

export function formatAgenda(
  matches: FootballMatch[],
  window: AgendaWindow,
  now = new Date(),
): string {
  const sorted = [...matches].sort(compareMatches);
  if (sorted.length === 0) {
    return `Nenhum jogo das competições acompanhadas encontrado para ${window.label}.`;
  }

  const multipleDays = window.dates.length > 1;
  const lines = [`🗓 Agenda para ${window.label}:`];
  let omitted = 0;
  for (const date of window.dates) {
    const dayMatches = sorted.filter((match) => match.date === date);
    if (dayMatches.length === 0) continue;
    const section = multipleDays ? [`\n📅 ${capitalize(formatDayLabel(date, now))}`] : [];
    for (const [competition, competitionMatches] of groupByCompetition(dayMatches)) {
      section.push(
        `${multipleDays ? '' : '\n'}🏆 ${competition}`,
        ...competitionMatches.map((match) => formatAgendaLine(match)),
      );
    }
    if ([...lines, ...section].join('\n').length > MAX_MESSAGE_LENGTH) {
      omitted += dayMatches.length;
      continue;
    }
    lines.push(...section);
  }
  if (omitted > 0) lines.push(`\n...e mais ${omitted} jogo(s).`);
  return lines.join('\n');
}

export function formatBotafogoAgenda(matches: FootballMatch[], now = new Date()): string {
  if (matches.length === 0) return 'Não encontrei jogos futuros do Botafogo confirmados.';
  const lines = ['🗓 Próximos jogos do Botafogo:'];
  for (const match of [...matches].sort(compareMatches)) {
    const line = `${formatAgendaLine(match, true, now)}\n   🏆 ${match.competition}`;
    if ([...lines, line].join('\n').length > MAX_MESSAGE_LENGTH) break;
    lines.push(line);
  }
  return lines.join('\n');
}

export function formatResult(result: FootballMatch | null, report: MatchReport | null): string {
  if (!result) return 'Não encontrei o último resultado do Botafogo.';
  const match = report?.match ?? result;
  const lines = [
    `🏁 Último jogo do Botafogo — ${match.competition}${formatOutcome(match)}`,
    `⭐ ${formatScoreLine(match)}`,
    `📅 ${capitalize(weekdayName(match.date))}, ${formatShortDateKey(match.date)}${match.venue ? ` · ${match.venue}` : ''}`,
  ];
  if (match.phase) lines.push(`🏆 ${match.phase}`);
  if (report) lines.push(...formatGoals(report.goals));
  return lines.join('\n');
}

export function formatLineups(options: {
  upcoming: FootballMatch | null;
  upcomingReport: MatchReport | null;
  last: FootballMatch | null;
  lastReport: MatchReport | null;
}): string {
  const upcomingLineups = availableLineups(options.upcomingReport);
  if (options.upcoming && upcomingLineups.length > 0) {
    return [
      `📋 Escalações — ${formatScoreLine(options.upcoming)}`,
      ...upcomingLineups.map(formatLineup),
    ].join('\n\n');
  }

  const lines: string[] = [];
  if (options.upcoming) {
    lines.push(
      `📋 A escalação de ${options.upcoming.homeTeam.name} x ${options.upcoming.awayTeam.name} ainda não saiu. Ela costuma ser divulgada cerca de 1h antes do jogo.`,
    );
  }
  const lastBotafogo = availableLineups(options.lastReport).find((lineup) => lineup.isBotafogo);
  if (options.last && lastBotafogo) {
    lines.push(
      `🔙 Última escalação (${formatScoreLine(options.last)}, ${formatShortDateKey(options.last.date)}):\n${formatLineup(lastBotafogo)}`,
    );
  }
  return lines.length > 0 ? lines.join('\n\n') : 'Não encontrei escalações do Botafogo.';
}

export function formatRound(data: BrasileiraoCompetition): string {
  const round =
    data.rounds.find((item) => item.number === data.tables[0]?.round.number) ?? data.rounds.at(-1);
  if (!round || round.matches.length === 0) {
    return 'A rodada do Brasileirão não está disponível no momento.';
  }

  const title = round.number ? `${round.number}ª rodada` : (round.label ?? 'Rodada atual');
  const lines = [`🏆 Brasileirão Série A — ${title}`];
  const matches = [...round.matches].sort((left, right) =>
    `${left.date ?? ''}T${left.time ?? ''}`.localeCompare(
      `${right.date ?? ''}T${right.time ?? ''}`,
    ),
  );
  for (const match of matches) {
    const home = match.homeTeam.name ?? '?';
    const away = match.awayTeam.name ?? '?';
    const isBotafogo = [match.homeTeam, match.awayTeam].some(
      (team) => team.name === 'Botafogo' || team.shortName === 'BOT',
    );
    const hasScore = match.score.home !== null && match.score.away !== null;
    const score = hasScore
      ? `${home} ${match.score.home} x ${match.score.away} ${away}`
      : `${home} x ${away}`;
    const when = match.date
      ? `${formatShortDateKey(match.date)} ${match.time ?? 'a definir'}`
      : 'data a definir';
    const status =
      match.status === 'live' ? ' — AO VIVO' : match.status === 'finished' ? ' — encerrado' : '';
    lines.push(`${isBotafogo ? '⭐' : '•'} ${when} — ${score}${status}`);
  }
  return lines.join('\n');
}

export function formatBrasileiraoTable(data: BrasileiraoCompetition): string {
  const table = data.tables[0];
  if (!table) return 'A tabela do Brasileirão não está disponível no momento.';

  const botafogoIndex = table.entries.findIndex(isBotafogoEntry);
  if (botafogoIndex < 0) return 'Não encontrei o Botafogo na tabela atual do Brasileirão.';

  const start = Math.max(0, botafogoIndex - 2);
  const nearby = table.entries.slice(start, botafogoIndex + 3);
  const round = table.round.number
    ? ` — ${table.round.number}ª rodada`
    : table.round.label
      ? ` — ${table.round.label}`
      : '';

  return [
    `🏆 Brasileirão Série A${round}`,
    ...nearby.map((entry) => formatTableEntry(entry, isBotafogoEntry(entry))),
  ].join('\n');
}

export function formatScoreLine(match: FootballMatch): string {
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  return match.score.home === null || match.score.away === null
    ? `${home} x ${away}`
    : `${home} ${match.score.home} x ${match.score.away} ${away}`;
}

export function formatWhen(match: FootballMatch, now = new Date(), capitalized = true): string {
  const label = formatDayLabel(match.date, now);
  const day = capitalized ? capitalize(label) : label;
  return match.time ? `${day} às ${match.time}` : `${day} — horário a definir`;
}

export function formatNaturalList(items: string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

function formatAgendaLine(match: FootballMatch, withDate = false, now = new Date()): string {
  const marker = involvesBotafogo(match) ? '⭐' : '•';
  const time = match.time ?? 'a definir';
  const when = withDate ? `${formatDayLabel(match.date, now)} ${time}` : time;
  const status =
    match.status === 'live'
      ? ` — AO VIVO${match.liveDetail ? ` ${match.liveDetail}` : ''}`
      : match.status === 'finished'
        ? ' — encerrado'
        : match.status === 'postponed'
          ? ' — adiado'
          : '';
  return `${marker} ${when} — ${formatScoreLine(match)}${status}`;
}

function formatDayLabel(date: string, now: Date): string {
  const today = localDateKey(now);
  if (date === today) return `hoje, ${formatShortDateKey(date)}`;
  if (date === addDays(today, 1)) return `amanhã, ${formatShortDateKey(date)}`;
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : `/${date.slice(0, 4)}`;
  return `${weekdayName(date)}, ${formatShortDateKey(date)}${year}`;
}

export function formatOutcome(match: FootballMatch): string {
  const { home, away } = match.score;
  if (home === null || away === null) return '';
  const botafogoGoals = match.homeTeam.isBotafogo ? home : away;
  const opponentGoals = match.homeTeam.isBotafogo ? away : home;
  if (botafogoGoals > opponentGoals) return ' ✅ vitória';
  if (botafogoGoals < opponentGoals) return ' ❌ derrota';
  return ' ➖ empate';
}

export function formatGoals(goals: MatchGoal[]): string[] {
  if (goals.length === 0) return [];
  const byTeam = new Map<string, string[]>();
  for (const goal of goals) {
    const details = [goal.penalty ? 'pênalti' : null, goal.ownGoal ? 'contra' : null].filter(
      Boolean,
    );
    const label = `${goal.scorer ?? 'Gol'} ${goal.minute}${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
    byTeam.set(goal.teamName, [...(byTeam.get(goal.teamName) ?? []), label.trim()]);
  }
  return [...byTeam].map(([team, scorers]) => `⚽ ${team}: ${scorers.join(', ')}`);
}

function availableLineups(report: MatchReport | null): TeamLineup[] {
  return (report?.lineups ?? [])
    .filter((lineup) => lineup.starters.length >= 11)
    .sort((left, right) => Number(right.isBotafogo) - Number(left.isBotafogo));
}

function formatLineup(lineup: TeamLineup): string {
  const formation = lineup.formation ? ` (${lineup.formation})` : '';
  return `${lineup.isBotafogo ? '⭐' : '•'} ${lineup.teamName}${formation}:\n${lineup.starters.join(', ')}`;
}

function groupByCompetition(matches: FootballMatch[]): Map<string, FootballMatch[]> {
  const grouped = new Map<string, FootballMatch[]>();
  for (const match of matches) {
    grouped.set(match.competition, [...(grouped.get(match.competition) ?? []), match]);
  }
  return grouped;
}

function isBotafogoEntry(entry: BrasileiraoTableEntry): boolean {
  return entry.team.name === 'Botafogo' || entry.team.shortName === 'BOT';
}

function formatTableEntry(entry: BrasileiraoTableEntry, highlighted: boolean): string {
  const marker = highlighted ? '➡️ ' : '';
  const position = entry.position ?? '-';
  const name = entry.team.name ?? 'Time desconhecido';
  const points = entry.points ?? '-';
  const stats = `${value(entry.matches)}J ${value(entry.wins)}V ${value(entry.draws)}E ${value(entry.losses)}D`;
  return `${marker}${position}º ${name} — ${points} pts | ${stats}`;
}

function value(input: number | null): number | '-' {
  return input ?? '-';
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
