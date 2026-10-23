import { getCamisa7Count } from '../clients/camisa7.js';
import { log } from '../lib/logger.js';
import { addDays, localDateKey } from '../lib/time.js';
import { Camisa7Snapshot } from '../models/camisa7-snapshot.js';
import { JobState } from '../models/job-state.js';

const STATE_ID = 'main';
const RETRY_INTERVAL_MILLISECONDS = 15 * 60_000;
const TREND_DAYS = 7;

export interface Camisa7Trend {
  previousCount: number;
  sinceDateKey: string;
}

export async function recordCamisa7Snapshot(count: number, now = new Date()): Promise<void> {
  await Camisa7Snapshot.updateOne(
    { dateKey: localDateKey(now) },
    { $set: { count, recordedAt: now } },
    { upsert: true },
  );
}

/** Contagem mais recente registrada há pelo menos sete dias, para calcular a variação semanal. */
export async function getCamisa7Trend(now = new Date()): Promise<Camisa7Trend | null> {
  const snapshot = await Camisa7Snapshot.findOne({
    dateKey: { $lte: addDays(localDateKey(now), -TREND_DAYS) },
  })
    .sort({ dateKey: -1 })
    .lean();
  return snapshot ? { previousCount: snapshot.count, sinceDateKey: snapshot.dateKey } : null;
}

/**
 * Garante uma contagem por dia, mesmo sem ninguém usar `!camisa7`. Em caso de falha da API,
 * tenta novamente no máximo a cada 15 minutos.
 */
export async function ensureDailyCamisa7Snapshot(
  now = new Date(),
  getCount: () => Promise<number> = getCamisa7Count,
): Promise<'recorded' | 'skipped'> {
  if (await Camisa7Snapshot.exists({ dateKey: localDateKey(now) })) return 'skipped';

  const claimed = await JobState.updateOne(
    {
      _id: STATE_ID,
      $or: [
        { camisa7AttemptedAt: { $exists: false } },
        { camisa7AttemptedAt: { $lte: new Date(now.getTime() - RETRY_INTERVAL_MILLISECONDS) } },
      ],
    },
    { $set: { camisa7AttemptedAt: now } },
  );
  if (claimed.modifiedCount === 0) return 'skipped';

  try {
    await recordCamisa7Snapshot(await getCount(), now);
    return 'recorded';
  } catch (error) {
    log('warn', 'camisa7.snapshot_failed', { error });
    return 'skipped';
  }
}
