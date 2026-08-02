import mongoose, { Schema, type Model } from 'mongoose';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CommandJobRecord {
  topicId: string;
  commentId: string;
  userId: string;
  topicTitle: string;
  text: string;
  authorName?: string;
  status: JobStatus;
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const commandJobSchema = new Schema<CommandJobRecord>(
  {
    topicId: { type: String, required: true },
    commentId: { type: String, required: true },
    userId: { type: String, required: true },
    topicTitle: { type: String, required: true },
    text: { type: String, required: true },
    authorName: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      required: true,
    },
    attempts: { type: Number, default: 0, required: true },
    nextAttemptAt: { type: Date, default: Date.now, required: true },
    leaseUntil: Date,
    lastError: String,
    completedAt: Date,
  },
  { timestamps: true },
);

commandJobSchema.index({ topicId: 1, commentId: 1 }, { unique: true });
commandJobSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });

export const CommandJob = (mongoose.models.CommandJob ??
  mongoose.model<CommandJobRecord>('CommandJob', commandJobSchema)) as Model<CommandJobRecord>;
