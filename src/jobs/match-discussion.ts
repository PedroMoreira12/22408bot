import type { VkClient, VkComment, VkTopic } from '../clients/vk.js';
import {
  ESPN_LINEUP_HEADING,
  formatEspnLineup,
  formatMatchDiscussion,
  formatOfficialLineup,
  LINEUP_HEADING,
} from '../football/discussion.js';
import {
  clubKey,
  normalizedName,
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
  // O tópico continua aguardando os onze mesmo se a agenda já apontar para o próximo adversário.
  const pending = await MatchDiscussion.findOne({
    groupId: vk.groupId,
    lineupPostedAt: { $exists: false },
    retryAt: { $lte: now },
    kickoffAt: {
      $gte: new Date(now.getTime() - LINEUP_WINDOW),
      $lte: new Date(now.getTime() + HOUR),
    },
    $or: [{ topicId: { $exists: true } }, { kickoffAt: { $lte: now } }],
  })
    .sort({ kickoffAt: 1 })
    .lean();
  if (pending) {
    try {
      stats.lineups = await publishPendingLineup(vk, football, pending, now, deadline);
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
  const opponent = fixture.botafogoHome ? fixture.away : fixture.home;
  const fixtureKey = [
    fixture.date,
    fixture.competition,
    fixture.botafogoHome,
    clubKey(opponent),
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
  const [tv, lineup] = await Promise.all([
    sheet?.broadcasts.length ? EMPTY_TV : localBroadcasts(football, match, openingDeadline),
    readLineup(football, match.id, currentFixture, sheet, openingDeadline),
  ]);
  const opening = formatMatchDiscussion(match, kickoff, sheet, tv, now, lineup);
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
  const hasLineup = existing ? await openingHasLineup(vk, existing) : opening.includesLineup;
  await MatchDiscussion.updateOne(key, {
    $set: {
      topicId,
      retryAt: new Date(now.getTime() + 30_000),
      ...(hasLineup ? { lineupPostedAt: now } : {}),
    },
  });
  return existing ? 0 : 1;
}

async function publishPendingLineup(
  vk: VkClient,
  football: FootballService,
  state: MatchDiscussionRecord,
  now: Date,
  deadline: number,
): Promise<number> {
  const key = { groupId: vk.groupId, matchId: state.matchId };
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
    const included = await openingHasLineup(vk, topic);
    await MatchDiscussion.updateOne(key, {
      $set: { topicId, ...(included ? { lineupPostedAt: now } : {}) },
    });
    if (included) return 0;
  }
  const sheet = await football.getOfficialMatchSheet(state.fixture);
  const kickoff = sheet ? sheet.kickoffAt : state.kickoffAt;
  if (
    !kickoff ||
    kickoff.getTime() - now.getTime() > HOUR ||
    now.getTime() - kickoff.getTime() > LINEUP_WINDOW
  )
    return 0;
  const fixture = { ...state.fixture, date: localDateKey(kickoff), time: localTime(kickoff) };
  const message = await readLineup(football, state.matchId, fixture, sheet, deadline);
  if (!message || Date.now() >= deadline) return 0;
  const opening = (await vk.getComments(topicId, 0, 1, 'asc')).items[0];
  if (!opening || Date.now() >= deadline) return 0;
  const alreadyIncluded = hasLineup(opening.text);
  if (!alreadyIncluded) await appendLineup(vk, state, topicId, opening, message);
  await MatchDiscussion.updateOne(key, { $set: { lineupPostedAt: now } });
  return alreadyIncluded ? 0 : 1;
}

async function appendLineup(
  vk: VkClient,
  state: MatchDiscussionRecord,
  topicId: number,
  opening: VkComment,
  message: string,
): Promise<void> {
  const text = opening.text ? `${opening.text}\n\n${message}` : message;
  if (!state.lineupAsComment && (await vk.editOwnComment(topicId, opening, text))) {
    const saved = (await vk.getComments(topicId, 0, 1, 'asc')).items[0];
    if (saved?.id !== opening.id || !hasLineup(saved.text))
      throw new Error('Escalação ainda não confirmada na leitura da abertura da VK');
    log('info', 'discussion.lineup_edited', {
      matchId: state.matchId,
      topicId,
      commentId: opening.id,
    });
    return;
  }
  // Fixar a forma de entrega antes do envio evita duplicação se o banco cair após o comentário.
  if (!state.lineupAsComment) {
    await MatchDiscussion.updateOne(
      { groupId: vk.groupId, matchId: state.matchId },
      {
        $set: { lineupAsComment: true },
      },
    );
  }
  await vk.createComment(topicId, null, message, `discussion:${vk.groupId}:${topicId}:lineup`);
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

async function openingHasLineup(vk: VkClient, topic: VkTopic): Promise<boolean> {
  const opening =
    topic.first_comment ?? (await vk.getComments(topic.id, 0, 1, 'asc')).items[0]?.text;
  return hasLineup(opening ?? '');
}

function hasLineup(text: string): boolean {
  return text.includes(LINEUP_HEADING) || text.includes(ESPN_LINEUP_HEADING);
}

async function readLineup(
  football: FootballService,
  matchId: string,
  fixture: SheetFixture,
  sheet: OfficialMatchSheet | null,
  deadline: number,
): Promise<string | null> {
  const official = formatOfficialLineup(sheet);
  if (official) return official;
  const budget = Math.min(4000, deadline - Date.now() - 2500);
  if (budget <= 0) return null;
  try {
    const report = await boundedRead(football.getMatchReport(matchId, fixture), budget, null);
    return formatEspnLineup(report);
  } catch (error) {
    log('warn', 'discussion.espn_lineup_failed', { matchId, error });
    return null;
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
