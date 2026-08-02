import { HttpError, isTransientError } from './vk.js';
import { withRetry } from '../lib/retry.js';

const COUNTER_URL = 'https://api.camisa7.botafogo.com.br/public/counter';

export async function getCamisa7Count(fetchImpl: typeof fetch = fetch): Promise<number> {
  return withRetry(
    async () => {
      const response = await fetchImpl(COUNTER_URL, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new HttpError(response.status, 'Camisa 7');
      const payload = (await response.json()) as { res?: unknown };
      const count = typeof payload.res === 'number' ? payload.res : Number(payload.res);
      if (!Number.isFinite(count) || count < 0)
        throw new Error('Resposta inválida da API Camisa 7');
      return count;
    },
    { attempts: 3, baseDelayMs: 300, shouldRetry: isTransientError },
  );
}
