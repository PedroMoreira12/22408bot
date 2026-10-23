export type BroadcastKind = 'open-tv' | 'pay-tv' | 'free-streaming' | 'paid-streaming' | 'other';

export interface Broadcast {
  name: string;
  kind: BroadcastKind;
}

export interface FootballTeam {
  id: string;
  name: string;
  isBotafogo: boolean;
}

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed';

export interface FootballMatch {
  /** Identificador com prefixo da fonte, por exemplo `espn:401841316` ou `ge:123`. */
  id: string;
  competition: string;
  phase: string | null;
  /** Instante de início em ISO 8601; quando o horário não foi confirmado, é apenas uma estimativa. */
  kickoffAt: string;
  /** Data civil em São Paulo (`AAAA-MM-DD`). */
  date: string;
  /** Horário em São Paulo (`HH:MM`) ou `null` quando ainda não confirmado. */
  time: string | null;
  status: MatchStatus;
  /** Minuto ou situação de um jogo em andamento, como `67'` ou `Intervalo`. */
  liveDetail: string | null;
  venue: string | null;
  broadcasts: Broadcast[];
  homeTeam: FootballTeam;
  awayTeam: FootballTeam;
  score: { home: number | null; away: number | null };
}

export interface MatchGoal {
  id: string;
  minute: string;
  teamName: string;
  isBotafogo: boolean;
  scorer: string | null;
  penalty: boolean;
  ownGoal: boolean;
}

export interface TeamLineup {
  teamName: string;
  isBotafogo: boolean;
  formation: string | null;
  starters: string[];
}

export interface MatchReport {
  match: FootballMatch;
  goals: MatchGoal[];
  lineups: TeamLineup[];
}

export function involvesBotafogo(match: FootballMatch): boolean {
  return match.homeTeam.isBotafogo || match.awayTeam.isBotafogo;
}

export function matchLabel(match: FootballMatch): string {
  return `${match.homeTeam.name} x ${match.awayTeam.name}`;
}

export function compareMatches(left: FootballMatch, right: FootballMatch): number {
  return left.kickoffAt.localeCompare(right.kickoffAt) || left.id.localeCompare(right.id);
}
