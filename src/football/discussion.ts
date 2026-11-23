import { BROADCAST_SOURCE_LABELS, formatNaturalList } from '../commands/sports.js';
import {
  opponentName,
  startingEleven,
  type OfficialMatchSheet,
  type SheetFixture,
} from './match-sheet.js';
import type { BroadcastInfo } from './service.js';
import type { FootballMatch, MatchReport } from './types.js';
import { formatDateKey, localDateKey, localTime } from '../lib/time.js';

export const LINEUP_HEADING = '📋 Escalação oficial do Botafogo';
export const ESPN_LINEUP_HEADING = '📋 Escalação do Botafogo (ESPN)';
export const OPPONENT_LINEUP_HEADING = '📋 Escalação do adversário — ';
export const LINEUP_SIDES = ['botafogo', 'opponent'] as const;
export type LineupSide = (typeof LINEUP_SIDES)[number];

export interface DiscussionLineup {
  side: LineupSide;
  text: string;
  sourceUrl?: string;
}

export function hasLineup(text: string, side: LineupSide): boolean {
  return side === 'botafogo'
    ? text.includes(LINEUP_HEADING) || text.includes(ESPN_LINEUP_HEADING)
    : text.includes(OPPONENT_LINEUP_HEADING);
}

export function discussionLineups(
  sides: readonly LineupSide[],
  fixture: SheetFixture,
  sheet: OfficialMatchSheet | null,
  report: MatchReport | null = null,
): DiscussionLineup[] {
  const opponentHeading = OPPONENT_LINEUP_HEADING + opponentName(fixture);
  const result: DiscussionLineup[] = [];
  for (const side of sides) {
    const isBotafogo = side === 'botafogo';
    const official = startingEleven((isBotafogo ? sheet?.starters : sheet?.opponentStarters) ?? []);
    if (sheet && official.length) {
      const heading = isBotafogo ? LINEUP_HEADING : opponentHeading;
      result.push({
        side,
        text: `${heading} (${sheet.lineupSource ?? sheet.source}):\n${formatNaturalList(official)}.`,
      });
      continue;
    }
    if (!report) continue;
    const team =
      isBotafogo === fixture.botafogoHome ? report.match.homeTeam : report.match.awayTeam;
    const [roster, duplicate] = report.lineups.filter((item) => item.teamId === team.id);
    if (!roster || duplicate || roster.isBotafogo !== isBotafogo) continue;
    const players = startingEleven(roster.starters);
    if (players.length) {
      const heading = isBotafogo ? ESPN_LINEUP_HEADING : `${opponentHeading} (ESPN)`;
      result.push({
        side,
        text: `${heading}:\n${formatNaturalList(players)}.`,
        sourceUrl: `https://www.espn.com.br/futebol/partida/_/jogoId/${report.match.id.replace(/^espn:/u, '')}`,
      });
    }
  }
  return result;
}

export function formatDiscussionLineups(lineups: DiscussionLineup[], existingText = ''): string {
  const text = lineups.map((lineup) => lineup.text).join('\n\n');
  // As duas equipes compartilham o mesmo link da partida na ESPN.
  const url = lineups.find((lineup) => lineup.sourceUrl)?.sourceUrl;
  return url && !existingText.includes(url) ? `${text}\n${url}` : text;
}

export function formatMatchDiscussion(
  match: FootballMatch,
  kickoff: Date,
  sheet: OfficialMatchSheet | null,
  fallback: BroadcastInfo,
  now: Date,
  lineups: DiscussionLineup[],
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
    formatDiscussionLineups(lineups),
  ]
    .filter(Boolean)
    .join('\n\n');
  return { title, body };
}
