import type { BrasileiraoCompetition, BrasileiraoTableEntry } from '../clients/brasileirao.js';
import type { FootballMatch, FootballSchedule } from '../clients/football-schedule.js';

const BOT_TEAM_ID = 263;
const TIME_ZONE = 'America/Sao_Paulo';
const MAX_MESSAGE_LENGTH = 3_500;

export type AgendaScope = 'today' | 'tomorrow' | 'botafogo';

export function formatBotafogoGame(data: FootballSchedule, now = new Date()): string {
  const matches = data.matches.filter(involvesBotafogo).sort(compareMatches);
  const currentLocalDateTime = localDateTimeKey(now);
  const match =
    matches.find((item) => item.status === 'live') ??
    matches.find(
      (item) =>
        item.status === 'scheduled' &&
        `${item.date}T${item.time ?? '23:59'}` >= currentLocalDateTime,
    );

  if (!match) return 'Não encontrei um próximo jogo do Botafogo confirmado.';

  const heading =
    match.status === 'live'
      ? `🔴 Botafogo em campo — ${match.competition}`
      : `⚽ Próximo jogo do Botafogo — ${match.competition}`;
  const details = [formatMatch(match, true)];
  details.push(
    `📺 Onde assistir: ${
      match.broadcasts.length > 0
        ? formatNaturalList(match.broadcasts)
        : 'transmissão ainda não informada'
    }`,
  );
  if (match.phase)
    details.push(`🏆 ${match.phase}${match.round ? ` — rodada ${match.round}` : ''}`);
  return [heading, ...details].join('\n');
}

export function formatAgenda(data: FootballSchedule, scope: AgendaScope, now = new Date()): string {
  if (scope === 'botafogo') return formatBotafogoAgenda(data, now);

  const offset = scope === 'tomorrow' ? 1 : 0;
  const targetDate = localDateKey(now, offset);
  const matches = data.matches.filter((match) => match.date === targetDate).sort(compareMatches);
  const label = scope === 'tomorrow' ? 'amanhã' : 'hoje';
  if (matches.length === 0) {
    return `Nenhum jogo dos campeonatos acompanhados encontrado para ${label}.`;
  }

  const lines = [`🗓 Agenda para ${label}:`];
  let omitted = 0;
  for (const [competition, competitionMatches] of groupByCompetition(matches)) {
    const section = [
      `\n🏆 ${competition}`,
      ...competitionMatches.map((match) => formatMatch(match, false)),
    ];
    if ([...lines, ...section].join('\n').length > MAX_MESSAGE_LENGTH) {
      omitted += competitionMatches.length;
      continue;
    }
    lines.push(...section);
  }
  if (omitted > 0) lines.push(`\n...e mais ${omitted} jogo(s).`);
  return lines.join('\n');
}

export function formatBrasileiraoTable(data: BrasileiraoCompetition): string {
  const table = data.tables[0];
  if (!table) return 'A tabela do Brasileirão não está disponível no momento.';

  const botafogoIndex = table.entries.findIndex(isBotafogoEntry);
  if (botafogoIndex < 0) return 'Não encontrei o Botafogo na tabela atual do Brasileirão.';

  const start = Math.max(0, botafogoIndex - 2);
  const nearby = table.entries.slice(start, botafogoIndex + 3);
  const round = table.round.label ? ` — ${table.round.label}` : '';

  return [
    `🏆 Brasileirão Série A${round}`,
    ...nearby.map((entry) => formatTableEntry(entry, isBotafogoEntry(entry))),
  ].join('\n');
}

function formatBotafogoAgenda(data: FootballSchedule, now: Date): string {
  const currentLocalDateTime = localDateTimeKey(now);
  const matches = data.matches
    .filter(involvesBotafogo)
    .filter(
      (match) =>
        match.status === 'live' ||
        (match.status === 'scheduled' &&
          `${match.date}T${match.time ?? '23:59'}` >= currentLocalDateTime),
    )
    .sort(compareMatches);
  if (matches.length === 0) return 'Não encontrei jogos futuros do Botafogo confirmados.';

  return [
    '🗓 Próximos jogos do Botafogo:',
    ...matches.map((match) => `${formatMatch(match, false)}\n   ${match.competition}`),
  ].join('\n');
}

function groupByCompetition(matches: FootballMatch[]): Map<string, FootballMatch[]> {
  const grouped = new Map<string, FootballMatch[]>();
  for (const match of matches) {
    const current = grouped.get(match.competition) ?? [];
    current.push(match);
    grouped.set(match.competition, current);
  }
  return grouped;
}

function involvesBotafogo(match: FootballMatch): boolean {
  return match.homeTeam.id === BOT_TEAM_ID || match.awayTeam.id === BOT_TEAM_ID;
}

function isBotafogoEntry(entry: BrasileiraoTableEntry): boolean {
  return entry.team.name === 'Botafogo' || entry.team.shortName === 'BOT';
}

function compareMatches(left: FootballMatch, right: FootballMatch): number {
  return `${left.date}T${left.time ?? ''}`.localeCompare(`${right.date}T${right.time ?? ''}`);
}

function formatMatch(match: FootballMatch, includeDetails: boolean): string {
  const home = match.homeTeam.popularName;
  const away = match.awayTeam.popularName;
  const score =
    match.score.home === null || match.score.away === null
      ? `${home} x ${away}`
      : `${home} ${match.score.home} x ${match.score.away} ${away}`;
  const botMarker = involvesBotafogo(match) ? '⭐ ' : '• ';
  const time = match.time ?? 'horário a confirmar';
  const date = formatDate(match.date);
  const status =
    match.status === 'live' ? ' — AO VIVO' : match.status === 'finished' ? ' — encerrado' : '';
  const line = `${botMarker}${date} às ${time} — ${score}${status}`;
  return includeDetails && match.venue ? `${line}\n🏟️ ${match.venue}` : line;
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

function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function localDateKey(now: Date, dayOffset: number): string {
  const parts = dateParts(now);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function localDateTimeKey(now: Date): string {
  const parts = dateParts(now, true);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function dateParts(
  now: Date,
  includeTime = false,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  };
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', options)
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatNaturalList(items: string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}
