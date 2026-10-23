import mongoose, { Schema, type Model } from 'mongoose';

export type PredictionStatus = 'open' | 'settled' | 'void';

export interface PredictionRecord {
  matchId: string;
  userId: string;
  topicId: string;
  commentId: string;
  homeGoals: number;
  awayGoals: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffAt: Date;
  /** Ano do jogo em São Paulo, usado no ranking anual do bolão. */
  season: number;
  status: PredictionStatus;
  points?: number;
  exact?: boolean;
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const predictionSchema = new Schema<PredictionRecord>(
  {
    matchId: { type: String, required: true },
    userId: { type: String, required: true },
    topicId: { type: String, required: true },
    commentId: { type: String, required: true },
    homeGoals: { type: Number, required: true, min: 0 },
    awayGoals: { type: Number, required: true, min: 0 },
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
    competition: { type: String, required: true },
    kickoffAt: { type: Date, required: true },
    season: { type: Number, required: true },
    status: { type: String, enum: ['open', 'settled', 'void'], default: 'open', required: true },
    points: Number,
    exact: Boolean,
    settledAt: Date,
  },
  { timestamps: true },
);

predictionSchema.index({ matchId: 1, userId: 1 }, { unique: true });
predictionSchema.index({ status: 1, kickoffAt: 1 });
predictionSchema.index({ season: 1, status: 1, userId: 1 });

export const Prediction = (mongoose.models.Prediction ??
  mongoose.model<PredictionRecord>('Prediction', predictionSchema)) as Model<PredictionRecord>;
