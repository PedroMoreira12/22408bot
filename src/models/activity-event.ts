import mongoose, { Schema, type Model } from 'mongoose';

export type ActivityEventType = 'comment' | 'topic';
export type ActivityEventSource = 'live' | 'backfill';

export interface ActivityEventRecord {
  eventKey: string;
  groupId: string;
  userId: string;
  type: ActivityEventType;
  source: ActivityEventSource;
  topicId: string;
  commentId?: string;
  occurredAt: Date;
  year: number;
  dateKey: string;
  isCommand: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const activityEventSchema = new Schema<ActivityEventRecord>(
  {
    eventKey: { type: String, required: true },
    groupId: { type: String, required: true },
    userId: { type: String, required: true },
    type: { type: String, enum: ['comment', 'topic'], required: true },
    source: { type: String, enum: ['live', 'backfill'], required: true },
    topicId: { type: String, required: true },
    commentId: String,
    occurredAt: { type: Date, required: true },
    year: { type: Number, required: true },
    dateKey: { type: String, required: true },
    isCommand: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
);

activityEventSchema.index({ groupId: 1, eventKey: 1 }, { unique: true });
activityEventSchema.index({ groupId: 1, year: 1, userId: 1, type: 1 });
activityEventSchema.index({ groupId: 1, year: 1, occurredAt: 1 });
activityEventSchema.index({ groupId: 1, userId: 1, occurredAt: 1 });
activityEventSchema.index({ groupId: 1, year: 1, dateKey: 1, userId: 1 });

export const ActivityEvent = (mongoose.models.ActivityEvent ??
  mongoose.model<ActivityEventRecord>(
    'ActivityEvent',
    activityEventSchema,
  )) as Model<ActivityEventRecord>;
