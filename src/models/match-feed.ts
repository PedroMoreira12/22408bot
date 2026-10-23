import mongoose, { Schema, type Model } from 'mongoose';

export interface MatchFeedRecord {
  matchId: string;
  topicId: string;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  pregamePostedAt?: Date;
  lineupPostedAt?: Date;
  finalPostedAt?: Date;
  bolaoPostedAt?: Date;
  postedGoalIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const matchFeedSchema = new Schema<MatchFeedRecord>(
  {
    matchId: { type: String, required: true },
    topicId: { type: String, required: true },
    kickoffAt: { type: Date, required: true },
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
    pregamePostedAt: Date,
    lineupPostedAt: Date,
    finalPostedAt: Date,
    bolaoPostedAt: Date,
    postedGoalIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

matchFeedSchema.index({ matchId: 1, topicId: 1 }, { unique: true });
matchFeedSchema.index({ topicId: 1, finalPostedAt: 1, kickoffAt: 1 });
// O estado só é necessário durante o jogo; documentos antigos são removidos após 90 dias.
matchFeedSchema.index({ kickoffAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const MatchFeed = (mongoose.models.MatchFeed ??
  mongoose.model<MatchFeedRecord>('MatchFeed', matchFeedSchema)) as Model<MatchFeedRecord>;
