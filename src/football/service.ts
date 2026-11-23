import { getBrasileiraoCompetition, type BrasileiraoCompetition } from '../clients/brasileirao.js';
import { CbfClient } from '../clients/cbf.js';
import { ConmebolClient } from '../clients/conmebol.js';
import { FerjClient } from '../clients/ferj.js';
import { EspnClient, TRACKED_LEAGUES } from '../clients/espn.js';
import { FutebolNaTvClient, type BroadcastListing } from '../clients/futebolnatv.js';
import { GeClient } from '../clients/ge.js';
import { log } from '../lib/logger.js';
import { addDays, isLastDayOfMonth, localDateKey } from '../lib/time.js';
import type { Broadcast, FootballMatch, MatchReport } from './types.js';
import { compareMatches, involvesBotafogo } from './types.js';
import { clubKey, type OfficialMatchSheet, type SheetFixture } from './match-sheet.js';

const BROADCAST_MATCH_WINDOW_MILLISECONDS = 3 * 60 * 60_000;

export type BroadcastSource = 'futebolnatv' | 'ge' | 'espn' | 'cbf';

export interface BroadcastInfo {
  broadcasts: Broadcast[];
  source: BroadcastSource | null;
}

export interface FootballService {
  /** Jogos futuros ou em andamento do Botafogo, em ordem cronológica. */
  getUpcomingBotafogoMatches(): Promise<FootballMatch[]>;
  /** Jogo em andamento ou o próximo jogo confirmado do Botafogo. */
  getNextBotafogoMatch(now?: Date): Promise<FootballMatch | null>;
  getDiscussionMatch(now: Date): Promise<FootballMatch | null>;
  /** Jogos encerrados do Botafogo, do mais recente para o mais antigo. */
  getRecentBotafogoResults(): Promise<FootballMatch[]>;
  getBroadcasts(match: FootballMatch): Promise<BroadcastInfo>;
  getOfficialMatchSheet(fixture: SheetFixture): Promise<OfficialMatchSheet | null>;
  /** Gols e escalações; `null` quando a partida não vem de uma fonte com esses detalhes. */
  getMatchReport(matchId: string): Promise<MatchReport | null>;
  /** Jogos das competições acompanhadas nas datas informadas (`AAAA-MM-DD`). */
  getAgendaMatches(dateKeys: string[]): Promise<FootballMatch[]>;
  getBrasileirao(): Promise<BrasileiraoCompetition>;
}

export interface FootballSources {
  cbf: Pick<CbfClient, 'getSheet' | 'getBotafogoMatches'>;
  ferj: Pick<FerjClient, 'getSheet'>;
  conmebol: Pick<ConmebolClient, 'getSheet'>;
  espn: Pick<
    EspnClient,
    | 'getBotafogoFixtures'
    | 'getBotafogoResults'
    | 'getBotafogoLiveMatches'
    | 'getLeagueMonth'
    | 'getMatchReport'
  >;
  ge: Pick<GeClient, 'getBotafogoMatches' | 'getDailyMatches'>;
  futebolNaTv: Pick<FutebolNaTvClient, 'getBotafogoListings'>;
  brasileirao: () => Promise<BrasileiraoCompetition>;
}

/**
 * Combina as fontes: ESPN para calendário, resultados e detalhes; futebolnatv para canais; ge
 * como reserva quando a ESPN falha ou quando o futebolnatv não informa a transmissão.
 */
export class DefaultFootballService implements FootballService {
  constructor(private readonly sources: FootballSources = defaultSources()) {}

  async getUpcomingBotafogoMatches(): Promise<FootballMatch[]> {
    let matches: FootballMatch[];
    try {
      matches = await this.sources.espn.getBotafogoFixtures();
      if (!matches.some((match) => match.status === 'live')) {
        matches = [...matches, ...(await this.getLiveFromSeason())];
      }
    } catch (error) {
      log('warn', 'football.espn_fixtures_failed', { error });
      matches = await this.sources.ge.getBotafogoMatches();
    }
    return matches
      .filter((match) => match.status === 'scheduled' || match.status === 'live')
      .sort(compareMatches);
  }

  /** A ESPN pode tirar o jogo em andamento dos próximos jogos; a lista da temporada o mantém. */
  private async getLiveFromSeason(): Promise<FootballMatch[]> {
    try {
      return await this.sources.espn.getBotafogoLiveMatches();
    } catch (error) {
      log('warn', 'football.espn_live_failed', { error });
      return [];
    }
  }

  async getNextBotafogoMatch(now = new Date()): Promise<FootballMatch | null> {
    const matches = await this.getUpcomingBotafogoMatches();
    const graceStart = now.getTime() - 3 * 60 * 60_000;
    return (
      matches.find((match) => match.status === 'live') ??
      matches.find((match) => new Date(match.kickoffAt).getTime() >= graceStart) ??
      null
    );
  }

  async getRecentBotafogoResults(): Promise<FootballMatch[]> {
    try {
      return await this.sources.espn.getBotafogoResults();
    } catch (error) {
      log('warn', 'football.espn_results_failed', { error });
      const daily = await this.sources.ge.getDailyMatches();
      return daily
        .filter((match) => involvesBotafogo(match) && match.status === 'finished')
        .sort(compareMatches)
        .reverse();
    }
  }

  /** No dia do jogo nacional, o A/D/D segue o horário da organizadora, inclusive em remarcações. */
  async getDiscussionMatch(now: Date): Promise<FootballMatch | null> {
    const end = now.getTime() + 3_600_000;
    const days = [...new Set([localDateKey(now), localDateKey(new Date(end))])];
    const calendars = await Promise.all(
      days.map((day) =>
        this.sources.cbf.getBotafogoMatches(day).catch((error: unknown) => {
          log('warn', 'discussion.cbf_schedule_failed', { day, error });
          return null;
        }),
      ),
    );
    const due = calendars
      .flatMap((list) => list ?? [])
      .find((match) => {
        const kickoff = Date.parse(match.kickoffAt);
        return (
          match.status === 'scheduled' && match.time && kickoff > now.getTime() && kickoff <= end
        );
      });
    if (due) return due;
    const next = await this.getNextBotafogoMatch(now);
    // Uma tabela nacional disponível prevalece sobre a hora antiga em um calendário secundário.
    if (
      next &&
      ['Brasileirão Série A', 'Copa do Brasil'].includes(next.competition) &&
      calendars[days.indexOf(next.date)] != null
    )
      return null;
    return next;
  }

  async getBroadcasts(match: FootballMatch): Promise<BroadcastInfo> {
    if (match.id.startsWith('cbf:') && match.broadcasts.length > 0) {
      return { broadcasts: match.broadcasts, source: 'cbf' };
    }
    if (!involvesBotafogo(match)) {
      return { broadcasts: match.broadcasts, source: match.broadcasts.length > 0 ? 'espn' : null };
    }

    try {
      const listing = findListing(await this.sources.futebolNaTv.getBotafogoListings(), match);
      if (listing && listing.broadcasts.length > 0) {
        return { broadcasts: listing.broadcasts, source: 'futebolnatv' };
      }
    } catch (error) {
      log('warn', 'football.futebolnatv_failed', { error });
    }

    if (match.id.startsWith('ge:') && match.broadcasts.length > 0) {
      return { broadcasts: match.broadcasts, source: 'ge' };
    }
    try {
      const geMatch = (await this.sources.ge.getBotafogoMatches()).find(
        (candidate) =>
          candidate.date === match.date &&
          clubKey(candidate.homeTeam.name) === clubKey(match.homeTeam.name) &&
          clubKey(candidate.awayTeam.name) === clubKey(match.awayTeam.name),
      );
      if (geMatch && geMatch.broadcasts.length > 0) {
        return { broadcasts: geMatch.broadcasts, source: 'ge' };
      }
    } catch (error) {
      log('warn', 'football.ge_broadcasts_failed', { error });
    }

    return { broadcasts: match.broadcasts, source: match.broadcasts.length > 0 ? 'espn' : null };
  }

  async getMatchReport(matchId: string): Promise<MatchReport | null> {
    if (!matchId.startsWith('espn:')) return null;
    return this.sources.espn.getMatchReport(matchId);
  }

  async getOfficialMatchSheet(fixture: SheetFixture): Promise<OfficialMatchSheet | null> {
    const read = (source: 'cbf' | 'ferj' | 'conmebol') =>
      this.sources[source].getSheet(fixture).catch((error: unknown) => {
        log('warn', `football.${source}_sheet_failed`, { error });
        return null;
      });
    switch (fixture.competition) {
      case 'Brasileirão Série A':
      case 'Copa do Brasil':
        return read('cbf');
      case 'Carioca':
        return read('ferj');
      case 'Libertadores':
      case 'Sul-Americana': {
        const [official, local] = await Promise.all([read('conmebol'), read('ferj')]);
        if (!official) return local;
        if (
          local?.starters.length === 11 &&
          official.kickoffAt?.getTime() === local.kickoffAt?.getTime()
        ) {
          return { ...official, starters: local.starters, lineupSource: 'FERJ' };
        }
        return official;
      }
      default:
        return null;
    }
  }

  async getAgendaMatches(dateKeys: string[]): Promise<FootballMatch[]> {
    const wanted = new Set(dateKeys);
    try {
      const months = [...new Set(dateKeys.flatMap(monthsCovering))];
      const lists = await Promise.all(
        Object.keys(TRACKED_LEAGUES).flatMap((league) =>
          months.map((month) => this.sources.espn.getLeagueMonth(league, month)),
        ),
      );
      return deduplicate(lists.flat().filter((match) => wanted.has(match.date)));
    } catch (error) {
      log('warn', 'football.espn_agenda_failed', { error });
      const daily = await this.sources.ge.getDailyMatches();
      return deduplicate(daily.filter((match) => wanted.has(match.date)));
    }
  }

  async getBrasileirao(): Promise<BrasileiraoCompetition> {
    return this.sources.brasileirao();
  }
}

let defaultService: FootballService | undefined;

export function getFootballService(): FootballService {
  defaultService ??= new DefaultFootballService();
  return defaultService;
}

function defaultSources(): FootballSources {
  return {
    cbf: new CbfClient(),
    ferj: new FerjClient(),
    conmebol: new ConmebolClient(),
    espn: new EspnClient(),
    ge: new GeClient(),
    futebolNaTv: new FutebolNaTvClient(),
    brasileirao: getBrasileiraoCompetition,
  };
}

/** Meses UTC (`AAAAMM`) que contêm os jogos de um dia em São Paulo. */
function monthsCovering(dateKey: string): string[] {
  const month = dateKey.slice(0, 7).replace('-', '');
  // Jogos após 21h do último dia do mês já caem no mês seguinte em UTC.
  if (!isLastDayOfMonth(dateKey)) return [month];
  return [month, addDays(dateKey, 1).slice(0, 7).replace('-', '')];
}

function deduplicate(matches: FootballMatch[]): FootballMatch[] {
  return [...new Map(matches.map((match) => [match.id, match])).values()].sort(compareMatches);
}

function findListing(
  listings: BroadcastListing[],
  match: FootballMatch,
): BroadcastListing | undefined {
  const kickoff = new Date(match.kickoffAt).getTime();
  return listings.find((listing) => {
    const listingKickoff = new Date(listing.kickoffAt).getTime();
    const sameTime =
      match.time === null
        ? localDateKey(new Date(listingKickoff)) === match.date
        : Math.abs(listingKickoff - kickoff) <= BROADCAST_MATCH_WINDOW_MILLISECONDS;
    const bot = match.homeTeam.isBotafogo ? listing.homeTeam : listing.awayTeam;
    const other = match.homeTeam.isBotafogo ? listing.awayTeam : listing.homeTeam;
    return (
      sameTime &&
      isBotafogoName(bot) &&
      clubKey(other) ===
        clubKey(match.homeTeam.isBotafogo ? match.awayTeam.name : match.homeTeam.name)
    );
  });
}

function isBotafogoName(name: string): boolean {
  return /^botafogo(\s*-?\s*rj)?$/i.test(name.trim());
}
