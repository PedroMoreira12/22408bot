import mongoose, { Schema, type Model } from 'mongoose';

export type ActivityBackfillTopicStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ActivityBackfillTopicRecord {
  topicId: string;
  topicCreatedAt?: Date;
  topicUpdatedAt: Date;
  status: ActivityBackfillTopicStatus;
  nextCommentOffset: number;
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  commentsScanned: number;
  eventsInserted: number;
  completedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const activityBackfillTopicSchema = new Schema<ActivityBackfillTopicRecord>(
  {
    topicId: { type: String, required: true, unique: true },
    topicCreatedAt: Date,
    topicUpdatedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      required: true,
    },
    nextCommentOffset: { type: Number, default: 0, required: true },
    attempts: { type: Number, default: 0, required: true },
    nextAttemptAt: { type: Date, default: Date.now, required: true },
    leaseUntil: Date,
    commentsScanned: { type: Number, default: 0, required: true },
    eventsInserted: { type: Number, default: 0, required: true },
    completedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

activityBackfillTopicSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
activityBackfillTopicSchema.index({ topicUpdatedAt: -1 });

export const ActivityBackfillTopic = (mongoose.models.ActivityBackfillTopic ??
  mongoose.model<ActivityBackfillTopicRecord>(
    'ActivityBackfillTopic',
    activityBackfillTopicSchema,
  )) as Model<ActivityBackfillTopicRecord>;
