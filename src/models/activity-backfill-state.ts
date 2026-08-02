import mongoose, { Schema, type Model } from 'mongoose';

export type ActivityBackfillStatus =
  'discovering' | 'collecting' | 'completed' | 'completed_with_errors';

export interface ActivityBackfillStateRecord {
  _id: string;
  status: ActivityBackfillStatus;
  cutoffAt: Date;
  upperBoundAt: Date;
  nextTopicOffset: number;
  topicsDiscovered: number;
  commentsScanned: number;
  eventsInserted: number;
  discoveryCompletedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const activityBackfillStateSchema = new Schema<ActivityBackfillStateRecord>(
  {
    _id: { type: String, required: true },
    status: {
      type: String,
      enum: ['discovering', 'collecting', 'completed', 'completed_with_errors'],
      required: true,
    },
    cutoffAt: { type: Date, required: true },
    upperBoundAt: { type: Date, required: true },
    nextTopicOffset: { type: Number, default: 0, required: true },
    topicsDiscovered: { type: Number, default: 0, required: true },
    commentsScanned: { type: Number, default: 0, required: true },
    eventsInserted: { type: Number, default: 0, required: true },
    discoveryCompletedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

export const ActivityBackfillState = (mongoose.models.ActivityBackfillState ??
  mongoose.model<ActivityBackfillStateRecord>(
    'ActivityBackfillState',
    activityBackfillStateSchema,
  )) as Model<ActivityBackfillStateRecord>;
