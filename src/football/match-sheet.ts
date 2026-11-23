import type { Broadcast, FootballMatch } from './types.js';

/** Identidade mínima para reencontrar a ficha depois que o jogo sair da agenda. */
export interface SheetFixture {
  competition: string;
  date: string;
  time: string;
  home: string;
  away: string;
  botafogoHome: boolean;
}

export interface OfficialMatchSheet {
  source: 'CBF' | 'FERJ' | 'CONMEBOL';
  url: string;
  kickoffAt: Date | null;
  phase: string | null;
  venue: string | null;
  broadcasts: Broadcast[];
  referee: string | null;
  starters: string[];
  lineupSource?: 'FERJ';
}

export function sheetFixture(match: FootballMatch): SheetFixture | null {
  if (!match.time || match.homeTeam.isBotafogo === match.awayTeam.isBotafogo) return null;
  return {
    competition: match.competition,
    date: match.date,
    time: match.time,
    home: match.homeTeam.name,
    away: match.awayTeam.name,
    botafogoHome: match.homeTeam.isBotafogo,
  };
}

export function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

const CLUB_ALIASES: Record<string, string> = {
  'atletico mg': 'atletico mineiro',
  'athletico pr': 'athletico paranaense',
  'atletico go': 'atletico goianiense',
  'rb bragantino': 'red bull bragantino',
  bragantino: 'red bull bragantino',
  'vasco da gama': 'vasco',
  'racing club': 'racing',
  'barcelona sc': 'barcelona',
};

/** Compara o clube entre grafias das tabelas, preservando a distinção entre homônimos. */
export function clubKey(name: string): string {
  const key = normalizedName(name)
    .replace(/\s*\([a-z]{2,3}\)\s*$/u, '')
    .replace(/\b(?:s\.?a\.?f|f\.?c|c\.?r|f\.?r)\b\.?/gu, ' ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  return CLUB_ALIASES[key] ?? key;
}

/** Só publica uma relação completa e sem atletas repetidos ou nomes vazios. */
export function startingEleven(names: string[]): string[] {
  const players = names.map((name) => name.trim());
  return players.length === 11 &&
    players.every(Boolean) &&
    new Set(players.map(normalizedName)).size === 11
    ? players
    : [];
}
