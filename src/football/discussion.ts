import { BROADCAST_SOURCE_LABELS, formatNaturalList } from '../commands/sports.js';
import type { OfficialMatchSheet } from './match-sheet.js';
import { startingEleven } from './match-sheet.js';
import type { BroadcastInfo } from './service.js';
import type { FootballMatch } from './types.js';
import { formatDateKey, localDateKey, localTime } from '../lib/time.js';

export const LINEUP_HEADING = '📋 Escalação oficial do Botafogo';

export function formatOfficialLineup(sheet: OfficialMatchSheet | null): string | null {
  if (!sheet) return null;
  const players = startingEleven(sheet.starters);
  return players.length
    ? `${LINEUP_HEADING} (${sheet.lineupSource ?? sheet.source}):\n${formatNaturalList(players)}.`
    : null;
}

export function formatMatchDiscussion(
  match: FootballMatch,
  kickoff: Date,
  sheet: OfficialMatchSheet | null,
  fallback: BroadcastInfo,
  now: Date,
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
  const lineup = formatOfficialLineup(sheet);
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
    lineup,
    [
      sheet && `Ficha oficial (${sheet.source}): ${sheet.url}`,
      !officialTv &&
        fallback.source &&
        channels.length &&
        `Fonte dos canais: ${BROADCAST_SOURCE_LABELS[fallback.source]}`,
    ]
      .filter(Boolean)
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
  return { title, body, includesLineup: lineup !== null };
}
