import mongoose, { Schema, type Model } from 'mongoose';

export type GameAlertStatus = 'pending' | 'sent' | 'expired' | 'cancelled' | 'failed';

export interface GameAlertRecord {
  matchId: string;
  userId: string;
  topicId: string;
  commentId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  /** Início previsto; atualizado a cada execução caso a fonte mude o horário. */
  kickoffAt: Date;
  status: GameAlertStatus;
  attempts: number;
  lastError?: string;
  sentAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const gameAlertSchema = new Schema<GameAlertRecord>(
  {
    matchId: { type: String, required: true },
    userId: { type: String, required: true },
    topicId: { type: String, required: true },
    commentId: { type: String, required: true },
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
    competition: { type: String, required: true },
    kickoffAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'expired', 'cancelled', 'failed'],
      default: 'pending',
      required: true,
    },
    attempts: { type: Number, default: 0, required: true },
    lastError: String,
    sentAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

gameAlertSchema.index({ matchId: 1, userId: 1 }, { unique: true });
gameAlertSchema.index({ status: 1, kickoffAt: 1 });
gameAlertSchema.index({ userId: 1, status: 1 });
gameAlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export const GameAlert = (mongoose.models.GameAlert ??
  mongoose.model<GameAlertRecord>('GameAlert', gameAlertSchema)) as Model<GameAlertRecord>;
