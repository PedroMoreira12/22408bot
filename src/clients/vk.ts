import { createHash } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { withRetry } from '../lib/retry.js';

const VK_API_BASE_URL = 'https://api.vk.com/method/';
const TRANSIENT_VK_CODES = new Set([1, 6, 10]);

export interface VkTopic {
  id: number;
  title: string;
  updated: number;
}

export interface VkComment {
  id: number;
  from_id: number;
  date: number;
  text: string;
}

export interface VkProfile {
  id: number;
  first_name: string;
}

export interface VkGroup {
  id: number;
  name: string;
}

export interface VkPage<T> {
  count: number;
  items: T[];
  profiles?: VkProfile[];
  groups?: VkGroup[];
}

interface VkSuccess<T> {
  response: T;
}

interface VkFailure {
  error: {
    error_code: number;
    error_msg: string;
  };
}

export class VkApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`VK API ${method} falhou (${code}): ${message}`);
    this.name = 'VkApiError';
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    service: string,
  ) {
    super(`${service} respondeu com HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export interface VkClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  requestSpacingMs?: number;
}

export class VkClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestSpacingMs: number;
  private nextRequestAt = 0;

  constructor(
    private readonly config: Pick<
      AppConfig,
      'accessToken' | 'communityAccessToken' | 'apiVersion' | 'groupId'
    >,
    options: VkClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.requestSpacingMs = options.requestSpacingMs ?? 350;
  }

  async getTopics(offset = 0, count = 100): Promise<VkPage<VkTopic>> {
    return this.call('board.getTopics', {
      group_id: this.config.groupId,
      order: 1,
      offset,
      count,
    });
  }

  async getComments(topicId: number, offset = 0, count = 100): Promise<VkPage<VkComment>> {
    return this.call('board.getComments', {
      group_id: this.config.groupId,
      topic_id: topicId,
      sort: 'desc',
      extended: 1,
      offset,
      count,
    });
  }

  async getUserFirstName(userId: number): Promise<string> {
    const users = await this.call<Array<{ first_name: string }>>('users.get', { user_ids: userId });
    const first = users[0];
    if (!first?.first_name) throw new Error(`Usuário VK ${userId} não encontrado`);
    return first.first_name;
  }

  async createComment(
    topicId: number,
    replyToCommentId: number,
    message: string,
    operationId: string,
  ): Promise<number> {
    return this.call('board.createComment', {
      group_id: this.config.groupId,
      topic_id: topicId,
      reply_to_comment: replyToCommentId,
      message,
      guid: deterministicGuid(operationId),
    });
  }

  async sendMessage(userId: number, message: string, operationId: string): Promise<number> {
    return this.call(
      'messages.send',
      {
        user_id: userId,
        message,
        random_id: deterministicRandomId(operationId),
      },
      this.config.communityAccessToken,
    );
  }

  private async call<T>(
    method: string,
    params: Record<string, string | number | boolean>,
    token = this.config.accessToken,
  ): Promise<T> {
    return withRetry(
      async () => {
        await this.throttle();
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) body.set(key, String(value));
        body.set('access_token', token);
        body.set('v', this.config.apiVersion);

        const response = await this.fetchImpl(`${VK_API_BASE_URL}${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new HttpError(response.status, 'VK API');

        const payload = (await response.json()) as VkSuccess<T> | VkFailure;
        if ('error' in payload) {
          throw new VkApiError(method, payload.error.error_code, payload.error.error_msg);
        }
        if (!('response' in payload)) throw new Error(`Resposta inválida da VK em ${method}`);
        return payload.response;
      },
      {
        attempts: 3,
        baseDelayMs: 300,
        sleep: this.sleep,
        shouldRetry: isTransientError,
      },
    );
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextRequestAt - now);
    this.nextRequestAt = Math.max(now, this.nextRequestAt) + this.requestSpacingMs;
    if (waitMs > 0) await this.sleep(waitMs);
  }
}

export function deterministicGuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

export function deterministicRandomId(value: string): number {
  const id = createHash('sha256').update(value).digest().readUInt32BE(0) & 0x7fffffff;
  return id || 1;
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof VkApiError) return TRANSIENT_VK_CODES.has(error.code);
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  return (
    error instanceof TypeError || (error instanceof Error && /abort|timeout/i.test(error.name))
  );
}
