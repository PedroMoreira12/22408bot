import mongoose, { Schema, type Model } from 'mongoose';

export type ReminderStatus = 'pending' | 'processing' | 'sent' | 'failed';

export interface ReminderRecord {
  dedupeKey?: string;
  topicId: string;
  messageId: string;
  userId: string;
  remindAt: Date;
  message?: string;
  status?: ReminderStatus;
  attempts?: number;
  nextAttemptAt?: Date;
  leaseUntil?: Date;
  lastError?: string;
  sentAt?: Date;
  expiresAt?: Date;
}

const reminderSchema = new Schema<ReminderRecord>({
  dedupeKey: String,
  topicId: { type: String, required: true },
  messageId: { type: String, required: true },
  userId: { type: String, required: true },
  remindAt: { type: Date, required: true },
  message: String,
  status: { type: String, enum: ['pending', 'processing', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  lastError: String,
  sentAt: Date,
  expiresAt: Date,
});

reminderSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
reminderSchema.index({ topicId: 1, messageId: 1 });
reminderSchema.index({ status: 1, remindAt: 1, nextAttemptAt: 1, leaseUntil: 1 });
reminderSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export const Reminder = (mongoose.models.Reminder ??
  mongoose.model<ReminderRecord>('Reminder', reminderSchema)) as Model<ReminderRecord>;
