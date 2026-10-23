import { HttpError, isTransientError } from './vk.js';
import { withRetry } from '../lib/retry.js';

const USER_AGENT = 'pimpao-bot-vk/2.1 (+https://github.com/PedroMoreira12/22408bot)';

export interface FetchOptions {
  /** Nome legível da fonte, usado nas mensagens de erro. */
  context: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  attempts?: number;
}

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const response = await fetchWithRetry(url, options);
  return response.text();
}

export async function fetchJson(url: string, options: FetchOptions): Promise<unknown> {
  const response = await fetchWithRetry(url, options);
  return response.json() as Promise<unknown>;
}

async function fetchWithRetry(url: string, options: FetchOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return withRetry(
    async () => {
      const response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, 'accept-language': 'pt-BR,pt;q=0.9' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) throw new HttpError(response.status, options.context);
      return response;
    },
    { attempts: options.attempts ?? 3, baseDelayMs: 300, shouldRetry: isTransientError },
  );
}

export interface KeyedCache<T> {
  get(key?: string): Promise<T>;
  clear(): void;
}

/**
 * Cache em memória por chave com deduplicação de requisições simultâneas. Funções serverless
 * reaproveitam a instância entre execuções próximas, então o cache reduz chamadas às fontes.
 */
export function createCache<T>(
  ttlMilliseconds: number,
  load: (key: string) => Promise<T>,
  maxEntries = 24,
): KeyedCache<T> {
  const entries = new Map<string, { expiresAt: number; value: T }>();
  const pending = new Map<string, Promise<T>>();

  return {
    async get(key = 'default') {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      let request = pending.get(key);
      if (!request) {
        request = load(key);
        pending.set(key, request);
      }
      try {
        const value = await request;
        entries.delete(key);
        entries.set(key, { value, expiresAt: Date.now() + ttlMilliseconds });
        const oldest = entries.keys().next().value;
        if (entries.size > maxEntries && oldest !== undefined) entries.delete(oldest);
        return value;
      } finally {
        pending.delete(key);
      }
    },
    clear() {
      entries.clear();
      pending.clear();
    },
  };
}
