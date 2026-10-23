import mongoose, { Schema, type Model } from 'mongoose';

export interface Camisa7SnapshotRecord {
  /** Dia civil em São Paulo (`AAAA-MM-DD`); guarda a última contagem observada no dia. */
  dateKey: string;
  count: number;
  recordedAt: Date;
}

const camisa7SnapshotSchema = new Schema<Camisa7SnapshotRecord>({
  dateKey: { type: String, required: true, unique: true },
  count: { type: Number, required: true, min: 0 },
  recordedAt: { type: Date, required: true },
});

export const Camisa7Snapshot = (mongoose.models.Camisa7Snapshot ??
  mongoose.model<Camisa7SnapshotRecord>(
    'Camisa7Snapshot',
    camisa7SnapshotSchema,
  )) as Model<Camisa7SnapshotRecord>;
