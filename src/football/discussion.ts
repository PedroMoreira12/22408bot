import { BROADCAST_SOURCE_LABELS, formatNaturalList } from '../commands/sports.js';
import type { OfficialMatchSheet } from './match-sheet.js';
import { startingEleven } from './match-sheet.js';
import type { BroadcastInfo } from './service.js';
import type { FootballMatch, MatchReport } from './types.js';
import { formatDateKey, localDateKey, localTime } from '../lib/time.js';

export const LINEUP_HEADING = '📋 Escalação oficial do Botafogo';
export const ESPN_LINEUP_HEADING = '📋 Escalação do Botafogo (ESPN)';

export function formatOfficialLineup(sheet: OfficialMatchSheet | null): string | null {
  if (!sheet) return null;
  const players = startingEleven(sheet.starters);
  return players.length
    ? `${LINEUP_HEADING} (${sheet.lineupSource ?? sheet.source}):\n${formatNaturalList(players)}.`
    : null;
}

export function formatEspnLineup(report: MatchReport | null): string | null {
  if (!report) return null;
  const [botafogo, another] = report.lineups.filter((team) => team.isBotafogo);
  if (!botafogo || another) return null;
  const players = startingEleven(botafogo.starters);
  if (!players.length) return null;
  const eventId = report.match.id.replace(/^espn:/u, '');
  return `${ESPN_LINEUP_HEADING}:\n${formatNaturalList(players)}.\nhttps://www.espn.com.br/futebol/partida/_/jogoId/${eventId}`;
}

export function formatMatchDiscussion(
  match: FootballMatch,
  kickoff: Date,
  sheet: OfficialMatchSheet | null,
  fallback: BroadcastInfo,
  now: Date,
  lineup: string | null = formatOfficialLineup(sheet),
) {
  const game = `${match.homeTeam.name} × ${match.awayTeam.name}`;
  const competition =
    match.competition === 'Brasileirão Série A' ? 'Brasileirão' : match.competition;
  const phase = sheet?.phase || match.phase;
  const date = localDateKey(kickoff);
  const displayDate = formatDateKey(date);
  const day = date === localDateKey(now) ? `Hoje (${displayDate})` : displayDate;
  const time = localTime(kickoff).replace(/:00$/u, 'h');
  const venue = sheet?.venue || [match.venue, match.venueCity].filter(Boolean).join(', ');
  const officialTv = sheet?.broadcasts.length ? sheet.broadcasts : null;
  const channels = (officialTv ?? fallback.broadcasts).map(({ name }) => name);
  const title = `A/D/D | ${game} | ${competition} – ${phase || displayDate}`;
  const body = [
    '📋 Ficha Técnica',
    [
      `🏆 Jogo: ${game}`,
      `📅 Data/Horário: ${day}, às ${time} (horário de Brasília)`,
      `📍 Local: ${venue || 'A confirmar'}`,
      `📺 Transmissão: ${formatNaturalList(channels) || 'A confirmar'}`,
      `⚖️ Arbitragem: ${sheet?.referee || 'A confirmar'}`,
    ].join('\n'),
    [
      sheet && `Ficha oficial (${sheet.source}): ${sheet.url}`,
      !officialTv &&
        fallback.source &&
        channels.length &&
        `Fonte dos canais: ${BROADCAST_SOURCE_LABELS[fallback.source]}`,
    ]
      .filter(Boolean)
      .join('\n'),
    lineup,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { title, body, includesLineup: lineup !== null };
}
