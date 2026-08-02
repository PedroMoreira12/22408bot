import { JobState } from '../models/job-state.js';

const STATE_ID = 'main';

export async function acquireJobLease(
  owner: string,
  now: Date,
  leaseMilliseconds = 70_000,
): Promise<boolean> {
  try {
    const result = await JobState.updateOne(
      {
        _id: STATE_ID,
        $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }],
      },
      {
        $set: {
          lockedUntil: new Date(now.getTime() + leaseMilliseconds),
          lockOwner: owner,
        },
        $setOnInsert: { _id: STATE_ID },
      },
      { upsert: true },
    );
    return result.acknowledged && (result.modifiedCount === 1 || result.upsertedCount === 1);
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

export async function releaseJobLease(owner: string, now = new Date()): Promise<void> {
  await JobState.updateOne(
    { _id: STATE_ID, lockOwner: owner },
    {
      $set: { lockedUntil: new Date(0), lastCompletedAt: now },
      $unset: { lockOwner: 1 },
    },
  );
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && Number(error.code) === 11000
  );
}
