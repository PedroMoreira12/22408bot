import mongoose, { Schema, type Model } from 'mongoose';

export interface PregameTopicRecord {
  matchId: string;
  /** Início previsto, atualizado a cada tentativa caso a fonte mude o horário. */
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

const pregameTopicSchema = new Schema<PregameTopicRecord>(
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

pregameTopicSchema.index({ matchId: 1 }, { unique: true });
// O estado só evita duplicatas antes do jogo; documentos antigos expiram em 180 dias.
pregameTopicSchema.index({ kickoffAt: 1 }, { expireAfterSeconds: 180 * 86_400 });

export const PregameTopic = (mongoose.models.PregameTopic ??
  mongoose.model<PregameTopicRecord>(
    'PregameTopic',
    pregameTopicSchema,
  )) as Model<PregameTopicRecord>;
