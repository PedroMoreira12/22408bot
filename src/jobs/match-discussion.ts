import type { VkClient, VkTopic } from '../clients/vk.js';
import {
  discussionLineups,
  formatDiscussionLineups,
  formatMatchDiscussion,
  hasLineup,
  LINEUP_SIDES,
  type DiscussionLineup,
  type LineupSide,
} from '../football/discussion.js';
import {
  clubKey,
  normalizedName,
  opponentName,
  sheetFixture,
  type OfficialMatchSheet,
  type SheetFixture,
} from '../football/match-sheet.js';
import type { BroadcastInfo, FootballService } from '../football/service.js';
import type { FootballMatch } from '../football/types.js';
import { log } from '../lib/logger.js';
import { localDateKey, localTime } from '../lib/time.js';
import { MatchDiscussion, type MatchDiscussionRecord } from '../models/match-discussion.js';
import { normalizeTitle } from './vk-topics.js';

const HOUR = 3_600_000;
const LINEUP_WINDOW = 6 * HOUR;
const EMPTY_TV: BroadcastInfo = { broadcasts: [], source: null };
const POSTED_AT = { botafogo: 'lineupPostedAt', opponent: 'opponentLineupPostedAt' } as const;
export interface DiscussionStats {
  topics: number;
  lineups: number;
}

export async function publishMatchDiscussion(
  vk: VkClient,
  football: FootballService,
  deadline: number,
  now = new Date(),
): Promise<DiscussionStats> {
  const started = Date.now();
  const stats = { topics: 0, lineups: 0 };
  // O registro anterior à escalação adversária pode já ter lineupPostedAt para o Botafogo.
  const pending = await MatchDiscussion.findOne({
    groupId: vk.groupId,
    retryAt: { $lte: now },
    kickoffAt: {
      $gte: new Date(now.getTime() - LINEUP_WINDOW),
      $lte: new Date(now.getTime() + HOUR),
    },
    $and: [
      {
        $or: [
          { lineupPostedAt: { $exists: false } },
          { opponentLineupPostedAt: { $exists: false } },
        ],
      },
      { $or: [{ topicId: { $exists: true } }, { kickoffAt: { $lte: now } }] },
    ],
  })
    .sort({ kickoffAt: 1 })
    .lean();
  if (pending) {
    try {
      stats.lineups = await publishPendingLineups(vk, football, pending, now, deadline);
    } catch (error) {
      log('warn', 'discussion.lineup_failed', { matchId: pending.matchId, error });
    }
  }

  if (Date.now() + 3000 >= deadline) return stats;
  const match = await boundedRead(
    football.getDiscussionMatch(now),
    Math.min(6000, deadline - Date.now() - 2500),
    null,
  );
  if (!match || match.status !== 'scheduled' || !openingDue(new Date(match.kickoffAt), now))
    return stats;
  const fixture = sheetFixture(match);
  if (fixture)
    stats.topics = await openDiscussion(
      vk,
      football,
      match,
      fixture,
      new Date(now.getTime() + Date.now() - started),
      deadline,
    );
  return stats;
}

function openingDue(kickoff: Date, now: Date): boolean {
  const remaining = kickoff.getTime() - now.getTime();
  return remaining > 0 && remaining <= HOUR;
}

async function openDiscussion(
  vk: VkClient,
  football: FootballService,
  match: FootballMatch,
  fixture: SheetFixture,
  now: Date,
  deadline: number,
): Promise<number> {
  const started = Date.now();
  const fixtureKey = [
    fixture.date,
    fixture.competition,
    fixture.botafogoHome,
    clubKey(opponentName(fixture)),
  ].join('|');
  const state = await MatchDiscussion.findOne({
    groupId: vk.groupId,
    $or: [{ matchId: match.id }, { fixtureKey }],
  }).lean();
  if (state?.topicId && state.kickoffAt.getTime() === Date.parse(match.kickoffAt)) return 0;
  if (state && state.retryAt > now) return 0;
  const sheet = await football.getOfficialMatchSheet(fixture);
  const kickoff = sheet ? sheet.kickoffAt : new Date(match.kickoffAt);
  if (!kickoff || !openingDue(kickoff, now)) return 0;
  const currentFixture = { ...fixture, date: localDateKey(kickoff), time: localTime(kickoff) };
  if (state?.topicId) {
    await MatchDiscussion.updateOne(
      { groupId: vk.groupId, matchId: state.matchId },
      { $set: { fixtureKey, fixture: currentFixture, kickoffAt: kickoff } },
    );
    return 0;
  }
  const openingDeadline = Math.min(deadline, started + (kickoff.getTime() - now.getTime()));
  const [tv, lineups] = await Promise.all([
    sheet?.broadcasts.length ? EMPTY_TV : localBroadcasts(football, match, openingDeadline),
    readLineups(football, match.id, currentFixture, sheet, LINEUP_SIDES, openingDeadline),
  ]);
  const opening = formatMatchDiscussion(match, kickoff, sheet, tv, now, lineups);
  const title = state?.title ?? opening.title;
  if (Date.now() >= deadline) return 0;

  const key = { groupId: vk.groupId, matchId: state?.matchId ?? match.id };
  const backoff = Math.min(10, 2 ** (state?.attempts ?? 0)) * 60_000;
  await MatchDiscussion.updateOne(
    key,
    {
      $inc: { attempts: 1 },
      $set: {
        fixtureKey,
        fixture: currentFixture,
        title,
        kickoffAt: kickoff,
        retryAt: new Date(now.getTime() + backoff),
      },
    },
    { upsert: true },
  );

  // Sob o lease global, conferimos a VK mesmo na primeira tentativa (o ADM pode ter aberto o A/D/D).
  const existing = await findDiscussion(vk, title, fixture, kickoff);
  if (
    !existing &&
    (Date.now() >= deadline || !openingDue(kickoff, new Date(now.getTime() + Date.now() - started)))
  )
    return 0;
  const topicId = existing?.id ?? (await vk.addTopic(title, opening.body));
  const included = existing
    ? await openingLineups(vk, existing)
    : lineups.map((lineup) => lineup.side);
  await MatchDiscussion.updateOne(key, {
    $set: {
      topicId,
      retryAt: new Date(now.getTime() + 30_000),
      ...lineupDates(included, now),
    },
  });
  return existing ? 0 : 1;
}

async function publishPendingLineups(
  vk: VkClient,
  football: FootballService,
  state: MatchDiscussionRecord,
  now: Date,
  deadline: number,
): Promise<number> {
  const key = { groupId: vk.groupId, matchId: state.matchId };
  let needed = LINEUP_SIDES.filter((side) => !state[POSTED_AT[side]]);
  let topicId = state.topicId;
  if (!topicId) {
    // Timeout no último minuto de pré-jogo: só recupera o ID, nunca abre um tópico após o início.
    const topic = await findDiscussion(vk, state.title, state.fixture, state.kickoffAt);
    if (!topic) {
      await MatchDiscussion.updateOne(key, {
        $set: { retryAt: new Date(now.getTime() + LINEUP_WINDOW) },
      });
      return 0;
    }
    topicId = topic.id;
    const included = await openingLineups(vk, topic);
    await MatchDiscussion.updateOne(key, {
      $set: {
        topicId,
        ...lineupDates(
          needed.filter((side) => included.includes(side)),
          now,
        ),
      },
    });
    needed = needed.filter((side) => !included.includes(side));
  }
  if (!needed.length) return 0;
  const sheet = await football.getOfficialMatchSheet(state.fixture);
  const kickoff = sheet ? sheet.kickoffAt : state.kickoffAt;
  if (
    !kickoff ||
    kickoff.getTime() - now.getTime() > HOUR ||
    now.getTime() - kickoff.getTime() > LINEUP_WINDOW
  )
    return 0;
  const fixture = { ...state.fixture, date: localDateKey(kickoff), time: localTime(kickoff) };
  const lineups = await readLineups(football, state.matchId, fixture, sheet, needed, deadline);
  if (!lineups.length || Date.now() >= deadline) return 0;
  const opening = (await vk.getComments(topicId, 0, 1, 'asc')).items[0];
  if (!opening || Date.now() >= deadline) return 0;
  const included = needed.filter((side) => hasLineup(opening.text, side));
  if (included.length) await MatchDiscussion.updateOne(key, { $set: lineupDates(included, now) });
  const additions = lineups.filter((lineup) => !included.includes(lineup.side));
  if (!additions.length) return 0;
  const message = formatDiscussionLineups(additions, opening.text);
  const text = [opening.text, message].filter(Boolean).join('\n\n');
  if (!state.lineupAsComment && (await vk.editOwnComment(topicId, opening, text))) {
    const saved = (await vk.getComments(topicId, 0, 1, 'asc')).items[0];
    if (saved?.id !== opening.id || !additions.every((lineup) => saved.text.includes(lineup.text)))
      throw new Error('Escalação ainda não confirmada na leitura da abertura da VK');
    const sides = additions.map((lineup) => lineup.side);
    await MatchDiscussion.updateOne(key, { $set: lineupDates(sides, now) });
    log('info', 'discussion.lineup_edited', {
      matchId: state.matchId,
      topicId,
      commentId: opening.id,
      sides,
    });
    return additions.length;
  }
  // Cada equipe pode sair em um momento diferente. O Botafogo mantém o guid dos tópicos antigos.
  if (!state.lineupAsComment) {
    await MatchDiscussion.updateOne(key, { $set: { lineupAsComment: true } });
  }
  let posted = 0;
  for (const lineup of additions) {
    if (Date.now() >= deadline) break;
    const suffix = lineup.side === 'botafogo' ? 'lineup' : 'opponent-lineup';
    try {
      await vk.createComment(
        topicId,
        null,
        formatDiscussionLineups([lineup]),
        `discussion:${vk.groupId}:${topicId}:${suffix}`,
      );
      await MatchDiscussion.updateOne(key, { $set: lineupDates([lineup.side], now) });
      posted++;
    } catch (error) {
      log('warn', 'discussion.lineup_failed', { matchId: state.matchId, side: lineup.side, error });
      break;
    }
  }
  return posted;
}

async function findDiscussion(
  vk: VkClient,
  title: string,
  fixture: SheetFixture,
  kickoff: Date,
): Promise<VkTopic | undefined> {
  const recent = await vk.getTopics(0, 100, 2, true);
  const matchup = normalizedName(`${fixture.home} x ${fixture.away}`);
  return recent.items.find((topic) => {
    if ((topic.created ?? 0) * 1000 < kickoff.getTime() - 24 * HOUR) return false;
    const decoded = normalizeTitle(topic.title);
    if (decoded === title) return true;
    // Aceita também um título manual no padrão "A/D/D | mandante × visitante".
    const fields = normalizedName(decoded)
      .replaceAll('×', 'x')
      .split('|')
      .map((field) => field.trim());
    return fields[0] === 'a/d/d' && fields[1] === matchup;
  });
}

async function openingLineups(vk: VkClient, topic: VkTopic): Promise<LineupSide[]> {
  const opening =
    topic.first_comment ?? (await vk.getComments(topic.id, 0, 1, 'asc')).items[0]?.text;
  return LINEUP_SIDES.filter((side) => hasLineup(opening ?? '', side));
}

function lineupDates(sides: LineupSide[], now: Date) {
  const dates: Partial<Record<(typeof POSTED_AT)[LineupSide], Date>> = {};
  for (const side of sides) dates[POSTED_AT[side]] = now;
  return dates;
}

async function readLineups(
  football: FootballService,
  matchId: string,
  fixture: SheetFixture,
  sheet: OfficialMatchSheet | null,
  sides: readonly LineupSide[],
  deadline: number,
): Promise<DiscussionLineup[]> {
  const official = discussionLineups(sides, fixture, sheet);
  const budget = Math.min(4000, deadline - Date.now() - 2500);
  if (official.length === sides.length || budget <= 0) return official;
  try {
    const report = await boundedRead(football.getMatchReport(matchId, fixture), budget, null);
    return report ? discussionLineups(sides, fixture, sheet, report) : official;
  } catch (error) {
    log('warn', 'discussion.espn_lineup_failed', { matchId, error });
    return official;
  }
}

/** As fontes secundárias podem repetir requisições. Limite a espera do cron apenas em leituras. */
async function boundedRead<T>(read: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), Math.max(0, milliseconds));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function localBroadcasts(
  football: FootballService,
  match: FootballMatch,
  deadline: number,
): Promise<BroadcastInfo> {
  try {
    const info = await boundedRead(
      football.getBroadcasts(match),
      Math.min(4000, deadline - Date.now() - 2500),
      EMPTY_TV,
    );
    // A lista da ESPN pode trazer emissoras de outro país.
    return info.source === 'espn' ? EMPTY_TV : info;
  } catch (error) {
    log('warn', 'discussion.broadcasts_failed', { matchId: match.id, error });
    return EMPTY_TV;
  }
}
