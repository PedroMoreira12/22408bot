import type { VkClient } from '../clients/vk.js';
import { formatBroadcastLines, formatScoreLine, formatWhen } from '../commands/sports.js';
import type { SettlementSummary } from '../football/predictions.js';
import type { FootballService } from '../football/service.js';
import type { FootballMatch, MatchGoal, MatchReport, TeamLineup } from '../football/types.js';
import { log } from '../lib/logger.js';
import { MatchFeed, type MatchFeedRecord } from '../models/match-feed.js';

const PREGAME_LEAD_MILLISECONDS = 2 * 60 * 60_000;
const REPORT_LEAD_MILLISECONDS = 75 * 60_000;
const FEED_WINDOW_MILLISECONDS = 6 * 60 * 60_000;

export interface MatchFeedStats {
  posts: number;
}

/**
 * Publica automaticamente no tópico configurado em `MATCH_TOPIC_ID`: chamada do dia de jogo,
 * escalações, gols e placar final. Cada publicação usa um `guid` determinístico, então uma
 * execução repetida não duplica comentários.
 */
export async function runMatchFeed(
  vk: VkClient,
  football: FootballService,
  topicId: number,
  deadline: number,
  now = new Date(),
): Promise<MatchFeedStats> {
  const stats: MatchFeedStats = { posts: 0 };
  const candidates = new Map<string, FootballMatch | null>();

  const upcoming = await football.getUpcomingBotafogoMatches();
  for (const match of upcoming) {
    const untilKickoff = new Date(match.kickoffAt).getTime() - now.getTime();
    const relevant = match.status === 'live' || untilKickoff <= PREGAME_LEAD_MILLISECONDS;
    if (match.id.startsWith('espn:') && match.time !== null && relevant) {
      candidates.set(match.id, match);
    }
  }
  const openFeeds = await MatchFeed.find({
    topicId: String(topicId),
    finalPostedAt: { $exists: false },
    kickoffAt: { $gte: new Date(now.getTime() - FEED_WINDOW_MILLISECONDS) },
  }).lean();
  for (const feed of openFeeds)
    if (!candidates.has(feed.matchId)) candidates.set(feed.matchId, null);

  for (const [matchId, scheduled] of candidates) {
    if (Date.now() >= deadline) break;
    try {
      stats.posts += await updateMatch(vk, football, topicId, matchId, scheduled, now);
    } catch (error) {
      log('warn', 'match_feed.failed', { matchId, error });
    }
  }
  return stats;
}

/** Publica o resumo do bolão de cada jogo conferido no tópico do feed. */
export async function postBolaoSummaries(
  vk: VkClient,
  topicId: number,
  summaries: SettlementSummary[],
  now = new Date(),
): Promise<number> {
  let posts = 0;
  for (const summary of summaries) {
    if (summary.total === 0) continue;
    const feed = await MatchFeed.findOne({
      matchId: summary.matchId,
      topicId: String(topicId),
    }).lean();
    if (feed?.bolaoPostedAt) continue;
    const names = await vk.getUserFirstNames(summary.exactUserIds.slice(0, 15).map(Number));
    const exactNames = summary.exactUserIds
      .slice(0, 15)
      .map((userId) => names.get(Number(userId)) ?? 'Membro');
    const extra = summary.exactUserIds.length - exactNames.length;
    const message = [
      `🎯 Bolão conferido — ${summary.scoreLine}`,
      exactNames.length > 0
        ? `✅ Placar exato: ${exactNames.join(', ')}${extra > 0 ? ` e mais ${extra}` : ''}`
        : '✅ Ninguém cravou o placar desta vez.',
      `👍 Acertaram o resultado: ${summary.outcomeCount}`,
      `📊 ${summary.total} palpite(s). Veja o ranking com !bolao`,
    ].join('\n');
    await vk.createComment(topicId, null, message, `feed:${summary.matchId}:bolao`);
    await MatchFeed.updateOne(
      { matchId: summary.matchId, topicId: String(topicId) },
      {
        $set: { bolaoPostedAt: now },
        $setOnInsert: { kickoffAt: now, homeTeam: '-', awayTeam: '-' },
      },
      { upsert: true },
    );
    posts += 1;
  }
  return posts;
}

async function updateMatch(
  vk: VkClient,
  football: FootballService,
  topicId: number,
  matchId: string,
  scheduled: FootballMatch | null,
  now: Date,
): Promise<number> {
  const filter = { matchId, topicId: String(topicId) };
  let feed: Pick<
    MatchFeedRecord,
    'kickoffAt' | 'pregamePostedAt' | 'lineupPostedAt' | 'finalPostedAt' | 'postedGoalIds'
  > | null = await MatchFeed.findOne(filter).lean();
  if (!feed && scheduled) {
    await MatchFeed.updateOne(
      filter,
      {
        $setOnInsert: {
          kickoffAt: new Date(scheduled.kickoffAt),
          homeTeam: scheduled.homeTeam.name,
          awayTeam: scheduled.awayTeam.name,
          postedGoalIds: [],
        },
      },
      { upsert: true },
    );
    feed = { kickoffAt: new Date(scheduled.kickoffAt), postedGoalIds: [] };
  }
  if (!feed) return 0;
  if (scheduled && scheduled.kickoffAt !== feed.kickoffAt.toISOString()) {
    feed = { ...feed, kickoffAt: new Date(scheduled.kickoffAt) };
    await MatchFeed.updateOne(filter, { $set: { kickoffAt: feed.kickoffAt } });
  }

  let posts = 0;
  const post = async (message: string, key: string, update: Record<string, unknown>) => {
    await vk.createComment(topicId, null, message, `feed:${matchId}:${key}`);
    await MatchFeed.updateOne(filter, update);
    posts += 1;
  };

  const kickoff = feed.kickoffAt.getTime();
  if (
    scheduled?.status === 'scheduled' &&
    !feed.pregamePostedAt &&
    now.getTime() < kickoff &&
    now.getTime() >= kickoff - PREGAME_LEAD_MILLISECONDS
  ) {
    const broadcasts = await football
      .getBroadcasts(scheduled)
      .catch(() => ({ broadcasts: [], source: null }));
    await post(formatPregame(scheduled, broadcasts, now), 'pregame', {
      $set: { pregamePostedAt: now },
    });
  }

  if (now.getTime() < kickoff - REPORT_LEAD_MILLISECONDS) return posts;
  const report = await football.getMatchReport(matchId);
  if (!report) return posts;

  const lineups = report.lineups.filter((lineup) => lineup.starters.length >= 11);
  if (!feed.lineupPostedAt && lineups.some((lineup) => lineup.isBotafogo)) {
    await post(formatLineupPost(report.match, lineups), 'lineup', {
      $set: { lineupPostedAt: now },
    });
  }

  const status = report.match.status;
  if (status === 'live' || status === 'finished') {
    const newGoals = report.goals.filter((goal) => !feed.postedGoalIds.includes(goal.id));
    if (newGoals.length > 0) {
      await post(
        formatGoalPost(report.match, newGoals),
        `goal:${newGoals.map((g) => g.id).join(',')}`,
        {
          $addToSet: { postedGoalIds: { $each: newGoals.map((goal) => goal.id) } },
        },
      );
    }
  }
  if (status === 'finished' && !feed.finalPostedAt) {
    await post(formatFinalPost(report), 'final', { $set: { finalPostedAt: now } });
  }
  return posts;
}

function formatPregame(
  match: FootballMatch,
  broadcasts: Awaited<ReturnType<FootballService['getBroadcasts']>>,
  now: Date,
): string {
  return [
    '🔥 É DIA DE JOGO, ALVINEGRO!',
    `⚽ ${formatScoreLine(match)} — ${match.competition}`,
    `🕓 ${formatWhen(match, now)}${match.venue ? ` · ${match.venue}` : ''}`,
    ...formatBroadcastLines(broadcasts),
    '🎯 Dê seu palpite: !palpite 2x1 (gols do mandante primeiro)',
    '🔔 Quer ser marcado 30 min antes? !avisar',
  ].join('\n');
}

function formatLineupPost(match: FootballMatch, lineups: TeamLineup[]): string {
  const ordered = [...lineups].sort(
    (left, right) => Number(right.isBotafogo) - Number(left.isBotafogo),
  );
  return [
    `📋 Escalações confirmadas — ${formatScoreLine(match)}`,
    ...ordered.map(
      (lineup) =>
        `\n${lineup.isBotafogo ? '⭐' : '•'} ${lineup.teamName}${lineup.formation ? ` (${lineup.formation})` : ''}:\n${lineup.starters.join(', ')}`,
    ),
  ].join('\n');
}

function formatGoalPost(match: FootballMatch, goals: MatchGoal[]): string {
  const lines = goals.map((goal) => {
    const details = [goal.penalty ? 'pênalti' : null, goal.ownGoal ? 'contra' : null].filter(
      Boolean,
    );
    const scorer = `${goal.scorer ?? 'gol'}${goal.minute ? `, ${goal.minute}` : ''}${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
    return goal.isBotafogo
      ? `⚽ GOOOOL DO BOTAFOGO! ${scorer}`
      : `⚽ Gol do ${goal.teamName}. ${scorer}`;
  });
  return [...lines, `📊 ${formatScoreLine(match)}`].join('\n');
}

function formatFinalPost(report: MatchReport): string {
  const { match } = report;
  const { home, away } = match.score;
  let outcome = '';
  if (home !== null && away !== null) {
    const botafogo = match.homeTeam.isBotafogo ? home : away;
    const opponent = match.homeTeam.isBotafogo ? away : home;
    outcome = botafogo > opponent ? ' ✅' : botafogo < opponent ? ' ❌' : ' ➖';
  }
  const scorers = new Map<string, string[]>();
  for (const goal of report.goals) {
    const label = `${goal.scorer ?? 'gol'} ${goal.minute}`.trim();
    scorers.set(goal.teamName, [...(scorers.get(goal.teamName) ?? []), label]);
  }
  return [
    `🏁 Fim de jogo: ${formatScoreLine(match)}${outcome}`,
    ...[...scorers].map(([team, names]) => `⚽ ${team}: ${names.join(', ')}`),
    '🎯 O bolão é conferido em instantes. Ranking: !bolao',
  ].join('\n');
}
