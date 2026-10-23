import type { AnyBulkWriteOperation } from 'mongoose';

import { localYear } from '../lib/time.js';
import { Prediction, type PredictionRecord } from '../models/prediction.js';
import type { FootballService } from './service.js';
import type { FootballMatch } from './types.js';

export const EXACT_SCORE_POINTS = 3;
export const OUTCOME_POINTS = 1;
/** Jogos são conferidos a partir de 1h45 após o início, tempo mínimo de uma partida. */
const SETTLEMENT_DELAY_MILLISECONDS = 105 * 60_000;
/** Tolerância para palpites enviados segundos antes do apito inicial. */
const KICKOFF_TOLERANCE_MILLISECONDS = 60_000;
const ABANDON_AFTER_MILLISECONDS = 7 * 86_400_000;

export interface PredictionInput {
  userId: number;
  topicId: number;
  commentId: number;
  home: number;
  away: number;
}

export type RegisterPredictionResult =
  | { status: 'registered' | 'updated'; match: FootballMatch }
  | { status: 'closed' | 'unsupported'; match: FootballMatch }
  | { status: 'no-match' };

export interface PredictionStatus {
  match: FootballMatch | null;
  prediction: Pick<PredictionRecord, 'homeGoals' | 'awayGoals'> | null;
  totalForMatch: number;
}

export interface PredictionRankingEntry {
  userId: string;
  points: number;
  exact: number;
  predictions: number;
}

export interface SettlementSummary {
  matchId: string;
  scoreLine: string;
  total: number;
  exactUserIds: string[];
  outcomeCount: number;
}

export function scorePrediction(
  prediction: { homeGoals: number; awayGoals: number },
  result: { home: number; away: number },
): { points: number; exact: boolean } {
  if (prediction.homeGoals === result.home && prediction.awayGoals === result.away) {
    return { points: EXACT_SCORE_POINTS, exact: true };
  }
  const predicted = Math.sign(prediction.homeGoals - prediction.awayGoals);
  const actual = Math.sign(result.home - result.away);
  return { points: predicted === actual ? OUTCOME_POINTS : 0, exact: false };
}

/** Registra ou atualiza o palpite para `match`, o próximo jogo do Botafogo. */
export async function registerPrediction(
  input: PredictionInput,
  match: FootballMatch | null,
  now = new Date(),
): Promise<RegisterPredictionResult> {
  if (!match) return { status: 'no-match' };
  // A conferência depende dos detalhes da ESPN; partidas vindas da fonte reserva não são aceitas.
  if (!match.id.startsWith('espn:')) return { status: 'unsupported', match };
  if (match.status !== 'scheduled' || new Date(match.kickoffAt).getTime() <= now.getTime()) {
    return { status: 'closed', match };
  }

  const result = await Prediction.updateOne(
    { matchId: match.id, userId: String(input.userId) },
    {
      $set: {
        topicId: String(input.topicId),
        commentId: String(input.commentId),
        homeGoals: input.home,
        awayGoals: input.away,
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        competition: match.competition,
        kickoffAt: new Date(match.kickoffAt),
        season: localYear(new Date(match.kickoffAt)),
      },
      $setOnInsert: { status: 'open' },
    },
    { upsert: true },
  );
  return { status: result.upsertedCount > 0 ? 'registered' : 'updated', match };
}

export async function getPredictionStatus(
  userId: number,
  match: FootballMatch | null,
): Promise<PredictionStatus> {
  if (!match) return { match: null, prediction: null, totalForMatch: 0 };
  const [prediction, totalForMatch] = await Promise.all([
    Prediction.findOne({ matchId: match.id, userId: String(userId) })
      .select({ homeGoals: 1, awayGoals: 1 })
      .lean(),
    Prediction.countDocuments({ matchId: match.id }),
  ]);
  return { match, prediction: prediction ?? null, totalForMatch };
}

export async function getPredictionRanking(season: number): Promise<PredictionRankingEntry[]> {
  return Prediction.aggregate<PredictionRankingEntry>([
    { $match: { season, status: 'settled' } },
    {
      $group: {
        _id: '$userId',
        points: { $sum: '$points' },
        exact: { $sum: { $cond: ['$exact', 1, 0] } },
        predictions: { $sum: 1 },
      },
    },
    { $sort: { points: -1, exact: -1, predictions: 1, _id: 1 } },
    { $project: { _id: 0, userId: '$_id', points: 1, exact: 1, predictions: 1 } },
  ]);
}

/** Pontua os palpites de jogos encerrados e acompanha remarcações de partidas. */
export async function settlePredictions(
  football: FootballService,
  now = new Date(),
  maxMatches = 3,
): Promise<SettlementSummary[]> {
  const due = await Prediction.aggregate<{ _id: string }>([
    {
      $match: {
        status: 'open',
        kickoffAt: { $lte: new Date(now.getTime() - SETTLEMENT_DELAY_MILLISECONDS) },
      },
    },
    { $group: { _id: '$matchId', kickoffAt: { $min: '$kickoffAt' } } },
    { $sort: { kickoffAt: 1 } },
    { $limit: maxMatches },
  ]);

  const summaries: SettlementSummary[] = [];
  for (const { _id: matchId } of due) {
    const report = await football.getMatchReport(matchId);
    if (!report) continue;
    const { match } = report;
    const kickoff = new Date(match.kickoffAt);

    if (match.status !== 'finished' || match.score.home === null || match.score.away === null) {
      if (
        match.status === 'postponed' &&
        now.getTime() - kickoff.getTime() > ABANDON_AFTER_MILLISECONDS
      ) {
        // Partida adiada sem nova data por mais de uma semana: os palpites são anulados.
        await Prediction.updateMany(
          { matchId, status: 'open' },
          { $set: { status: 'void', points: 0, exact: false, settledAt: now } },
        );
      } else if (kickoff.getTime() > now.getTime() - SETTLEMENT_DELAY_MILLISECONDS) {
        // Jogo remarcado: adia a conferência para o novo horário.
        await Prediction.updateMany({ matchId, status: 'open' }, { $set: { kickoffAt: kickoff } });
      }
      continue;
    }

    const result = { home: match.score.home, away: match.score.away };
    const predictions = await Prediction.find({ matchId, status: 'open' })
      .select({ _id: 1, userId: 1, homeGoals: 1, awayGoals: 1, updatedAt: 1 })
      .lean();
    const exactUserIds: string[] = [];
    let outcomeCount = 0;
    const operations: Array<AnyBulkWriteOperation<PredictionRecord>> = predictions.map(
      (prediction) => {
        const late =
          prediction.updatedAt.getTime() > kickoff.getTime() + KICKOFF_TOLERANCE_MILLISECONDS;
        if (late) {
          return {
            updateOne: {
              filter: { _id: prediction._id, status: 'open' },
              update: { $set: { status: 'void', points: 0, exact: false, settledAt: now } },
            },
          };
        }
        const score = scorePrediction(prediction, result);
        if (score.exact) exactUserIds.push(prediction.userId);
        else if (score.points > 0) outcomeCount += 1;
        return {
          updateOne: {
            filter: { _id: prediction._id, status: 'open' },
            update: { $set: { status: 'settled', ...score, settledAt: now } },
          },
        };
      },
    );
    if (operations.length > 0) await Prediction.bulkWrite(operations, { ordered: false });
    summaries.push({
      matchId,
      scoreLine: `${match.homeTeam.name} ${result.home} x ${result.away} ${match.awayTeam.name}`,
      total: predictions.length,
      exactUserIds,
      outcomeCount,
    });
  }
  return summaries;
}
