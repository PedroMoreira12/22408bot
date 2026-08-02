import mongoose, { Schema, type Model } from 'mongoose';

export interface TopicCursorRecord {
  topicId: string;
  lastCommentId: string;
  lastCommentDate: Date;
  updatedAt: Date;
}

const topicCursorSchema = new Schema<TopicCursorRecord>(
  {
    topicId: { type: String, required: true, unique: true },
    lastCommentId: { type: String, required: true },
    lastCommentDate: { type: Date, required: true },
  },
  { timestamps: true },
);

export const TopicCursor = (mongoose.models.TopicCursor ??
  mongoose.model<TopicCursorRecord>('TopicCursor', topicCursorSchema)) as Model<TopicCursorRecord>;
