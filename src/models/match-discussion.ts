import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const fixtureSchema = new Schema(
  {
    competition: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    home: { type: String, required: true },
    away: { type: String, required: true },
    botafogoHome: { type: Boolean, required: true },
  },
  { _id: false },
);

const discussionSchema = new Schema(
  {
    groupId: { type: Number, required: true },
    matchId: { type: String, required: true },
    fixtureKey: { type: String, required: true },
    fixture: { type: fixtureSchema, required: true },
    kickoffAt: { type: Date, required: true },
    title: { type: String, required: true },
    attempts: { type: Number, required: true },
    retryAt: { type: Date, required: true },
    topicId: Number,
    lineupPostedAt: Date,
    lineupAsComment: Boolean,
  },
  { timestamps: true },
);
discussionSchema.index({ groupId: 1, matchId: 1 }, { unique: true });
// A agenda pode alternar entre ESPN e ge para o mesmo confronto.
discussionSchema.index({ groupId: 1, fixtureKey: 1 }, { unique: true });
discussionSchema.index({ groupId: 1, kickoffAt: 1 });
discussionSchema.index({ kickoffAt: 1 }, { expireAfterSeconds: 180 * 86_400 });

export type MatchDiscussionRecord = InferSchemaType<typeof discussionSchema>;
export const MatchDiscussion = (mongoose.models.MatchDiscussion ??
  mongoose.model<MatchDiscussionRecord>(
    'MatchDiscussion',
    discussionSchema,
  )) as Model<MatchDiscussionRecord>;
