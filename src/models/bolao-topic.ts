import mongoose, { Schema, type Model } from 'mongoose';

export interface BolaoTopicRecord {
  matchId: string;
  kickoffAt: Date;
  attempts: number;
  /** Lease e backoff: nenhuma tentativa começa antes deste instante. */
  retryAt?: Date;
  title?: string;
  topicId?: string;
  postedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bolaoTopicSchema = new Schema<BolaoTopicRecord>(
  {
    matchId: { type: String, required: true },
    kickoffAt: { type: Date, required: true },
    // Sem `default`: o job cria o documento com `$inc`, que conflitaria com o valor padrão.
    attempts: { type: Number, required: true },
    retryAt: Date,
    title: String,
    topicId: String,
    postedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

bolaoTopicSchema.index({ matchId: 1 }, { unique: true });
// O estado só evita duplicatas logo após a conferência; documentos antigos expiram em 180 dias.
bolaoTopicSchema.index({ kickoffAt: 1 }, { expireAfterSeconds: 180 * 86_400 });

export const BolaoTopic = (mongoose.models.BolaoTopic ??
  mongoose.model<BolaoTopicRecord>('BolaoTopic', bolaoTopicSchema)) as Model<BolaoTopicRecord>;
