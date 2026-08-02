export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  shouldRetry: (error: unknown) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === attempts || !options.shouldRetry(error)) throw error;
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      await sleep(exponential + Math.floor(random() * baseDelayMs));
    }
  }

  throw new Error('Retry terminou sem resultado');
}
