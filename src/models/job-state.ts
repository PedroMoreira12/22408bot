import mongoose, { Schema, type Model } from 'mongoose';

export interface JobStateRecord {
  _id: string;
  initializedAt?: Date;
  lastSuccessfulPollAt?: Date;
  lockedUntil?: Date;
  lockOwner?: string;
  lastCompletedAt?: Date;
  camisa7AttemptedAt?: Date;
}

const jobStateSchema = new Schema<JobStateRecord>({
  _id: { type: String, required: true },
  initializedAt: Date,
  lastSuccessfulPollAt: Date,
  lockedUntil: Date,
  lockOwner: String,
  lastCompletedAt: Date,
  camisa7AttemptedAt: Date,
});

export const JobState = (mongoose.models.JobState ??
  mongoose.model<JobStateRecord>('JobState', jobStateSchema)) as Model<JobStateRecord>;
