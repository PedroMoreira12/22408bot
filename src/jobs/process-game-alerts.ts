import type { VkClient } from '../clients/vk.js';
import { formatBroadcastLines } from '../commands/sports.js';
import type { BroadcastInfo, FootballService } from '../football/service.js';
import type { FootballMatch } from '../football/types.js';
import { log } from '../lib/logger.js';
import { localTime } from '../lib/time.js';
import { GameAlert } from '../models/game-alert.js';
import { errorMessage } from './process-commands.js';

const ALERT_LEAD_MILLISECONDS = 30 * 60_000;
/** Depois disso o aviso perde o sentido e é descartado (por exemplo, após uma pausa do cron). */
const LATE_LIMIT_MILLISECONDS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const SENT_RETENTION_MILLISECONDS = 30 * 86_400_000;

export interface GameAlertStats {
  sent: number;
  failed: number;
  expired: number;
}

/** Marca, 30 minutos antes do jogo, quem pediu `!avisar`. Acompanha mudanças de horário. */
export async function processGameAlerts(
  vk: VkClient,
  football: FootballService,
  deadline: number,
  now = new Date(),
): Promise<GameAlertStats> {
  const stats: GameAlertStats = { sent: 0, failed: 0, expired: 0 };
  const pending = await GameAlert.find({ status: 'pending' })
    .sort({ kickoffAt: 1 })
    .limit(200)
    .lean();
  if (pending.length === 0) return stats;

  let fixtures: FootballMatch[] | undefined;
  try {
    fixtures = await football.getUpcomingBotafogoMatches();
  } catch (error) {
    log('warn', 'game_alerts.fixtures_failed', { error });
  }

  const due: Array<{ alert: (typeof pending)[number]; match: FootballMatch | undefined }> = [];
  for (const alert of pending) {
    const match = fixtures?.find((item) => item.id === alert.matchId);
    let kickoff = alert.kickoffAt;
    if (match && match.kickoffAt !== kickoff.toISOString()) {
      kickoff = new Date(match.kickoffAt);
      await GameAlert.updateOne({ _id: alert._id }, { $set: { kickoffAt: kickoff } });
    }

    const late = now.getTime() > kickoff.getTime() + LATE_LIMIT_MILLISECONDS;
    if (late || match?.status === 'finished') {
      await GameAlert.updateOne(
        { _id: alert._id, status: 'pending' },
        {
          $set: {
            status: 'expired',
            expiresAt: new Date(now.getTime() + SENT_RETENTION_MILLISECONDS),
          },
        },
      );
      stats.expired += 1;
      continue;
    }
    // Sem horário confirmado, a fonte usa uma estimativa; espera a confirmação para avisar.
    const unconfirmed = match ? match.time === null : false;
    if (!unconfirmed && now.getTime() >= kickoff.getTime() - ALERT_LEAD_MILLISECONDS) {
      due.push({ alert: { ...alert, kickoffAt: kickoff }, match });
    }
  }
  if (due.length === 0) return stats;

  const names = await vk.getUserFirstNames(due.map(({ alert }) => Number(alert.userId)));
  const broadcastsByMatch = new Map<string, BroadcastInfo>();
  for (const { alert, match } of due) {
    if (Date.now() >= deadline) break;
    if (match && !broadcastsByMatch.has(match.id)) {
      broadcastsByMatch.set(
        match.id,
        await football.getBroadcasts(match).catch(() => ({ broadcasts: [], source: null })),
      );
    }
    const broadcasts = match ? broadcastsByMatch.get(match.id) : undefined;
    const name = names.get(Number(alert.userId)) ?? 'torcedor';
    const message = [
      `[post${alert.commentId}|${name}], ⏰ Falta pouco! ${alert.homeTeam} x ${alert.awayTeam} começa às ${localTime(alert.kickoffAt)} (${alert.competition}).`,
      ...(broadcasts ? formatBroadcastLines(broadcasts) : []),
    ].join('\n');

    try {
      await vk.createComment(
        Number(alert.topicId),
        Number(alert.commentId),
        message,
        `game-alert:${alert.matchId}:${alert.userId}`,
      );
      await GameAlert.updateOne(
        { _id: alert._id },
        {
          $set: {
            status: 'sent',
            sentAt: now,
            expiresAt: new Date(now.getTime() + SENT_RETENTION_MILLISECONDS),
          },
          $unset: { lastError: 1 },
        },
      );
      stats.sent += 1;
    } catch (error) {
      const attempts = alert.attempts + 1;
      await GameAlert.updateOne(
        { _id: alert._id },
        {
          $set: {
            attempts,
            lastError: errorMessage(error),
            ...(attempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
          },
        },
      );
      log('error', 'game_alert.failed', { matchId: alert.matchId, attempt: attempts, error });
      stats.failed += 1;
    }
  }
  return stats;
}
