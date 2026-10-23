import { GameAlert, type GameAlertRecord } from '../models/game-alert.js';
import type { FootballMatch } from './types.js';

export interface GameAlertInput {
  userId: number;
  topicId: number;
  commentId: number;
}

export type SubscribeGameAlertResult =
  | { status: 'created' | 'exists'; match: FootballMatch }
  | { status: 'started'; match: FootballMatch }
  | { status: 'no-match' };

/** Inscreve o autor para ser marcado 30 minutos antes de `match`, o próximo jogo do Botafogo. */
export async function subscribeGameAlert(
  input: GameAlertInput,
  match: FootballMatch | null,
  now = new Date(),
): Promise<SubscribeGameAlertResult> {
  if (!match) return { status: 'no-match' };
  if (match.status !== 'scheduled' || new Date(match.kickoffAt).getTime() <= now.getTime()) {
    return { status: 'started', match };
  }

  const filter = { matchId: match.id, userId: String(input.userId) };
  const existing = await GameAlert.findOne(filter).select({ status: 1 }).lean();
  if (existing?.status === 'pending') return { status: 'exists', match };

  await GameAlert.updateOne(
    filter,
    {
      $set: {
        topicId: String(input.topicId),
        commentId: String(input.commentId),
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        competition: match.competition,
        kickoffAt: new Date(match.kickoffAt),
        status: 'pending',
        attempts: 0,
      },
      $unset: { lastError: 1, sentAt: 1, expiresAt: 1 },
    },
    { upsert: true },
  );
  return { status: 'created', match };
}

export async function cancelGameAlerts(userId: number): Promise<number> {
  const result = await GameAlert.updateMany(
    { userId: String(userId), status: 'pending' },
    { $set: { status: 'cancelled', expiresAt: new Date(Date.now() + 30 * 86_400_000) } },
  );
  return result.modifiedCount;
}

export async function listPendingGameAlerts(
  userId: number,
): Promise<Array<Pick<GameAlertRecord, 'homeTeam' | 'awayTeam' | 'kickoffAt'>>> {
  return GameAlert.find({ userId: String(userId), status: 'pending' })
    .select({ homeTeam: 1, awayTeam: 1, kickoffAt: 1 })
    .sort({ kickoffAt: 1 })
    .limit(5)
    .lean();
}
