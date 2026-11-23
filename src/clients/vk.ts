import { createHash } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { withRetry } from '../lib/retry.js';

const VK_API_BASE_URL = 'https://api.vk.com/method/';
const TRANSIENT_VK_CODES = new Set([1, 6, 10]);
const USERS_GET_BATCH_SIZE = 500;

export interface VkTopic {
  id: number;
  title: string;
  created?: number;
  created_by?: number;
  updated: number;
  is_fixed?: number;
  first_comment?: string;
}

export interface VkComment {
  id: number;
  from_id: number;
  date: number;
  text: string;
  can_edit?: 0 | 1;
  attachments?: VkCommentAttachment[];
}

type BoardMediaType = 'photo' | 'video' | 'audio' | 'doc';
type VkCommentAttachment = {
  type: string;
  link?: { url: string };
} & Partial<Record<BoardMediaType, { owner_id: number; id: number; access_key?: string }>>;

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

  get groupId(): number {
    return this.config.groupId;
  }

  async getTopics(
    offset = 0,
    count = 100,
    order: 1 | 2 | -1 | -2 = 1,
    previewOpening = false,
  ): Promise<VkPage<VkTopic>> {
    return this.call('board.getTopics', {
      group_id: this.config.groupId,
      order,
      offset,
      count,
      ...(previewOpening ? { preview: 1, preview_length: 0 } : {}),
    });
  }

  async getComments(
    topicId: number,
    offset = 0,
    count = 100,
    sort: 'asc' | 'desc' = 'desc',
  ): Promise<VkPage<VkComment>> {
    return this.call('board.getComments', {
      group_id: this.config.groupId,
      topic_id: topicId,
      sort,
      extended: 1,
      offset,
      count,
    });
  }

  async getUserFirstName(userId: number): Promise<string> {
    const name = (await this.getUserFirstNames([userId])).get(userId);
    if (!name) throw new Error(`Usuário VK ${userId} não encontrado`);
    return name;
  }

  /** Busca vários nomes em uma única chamada de `users.get`. */
  async getUserFirstNames(userIds: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(userIds)].filter((id) => id > 0);
    const names = new Map<number, string>();
    for (let start = 0; start < unique.length; start += USERS_GET_BATCH_SIZE) {
      const batch = unique.slice(start, start + USERS_GET_BATCH_SIZE);
      const users = await this.call<Array<{ id: number; first_name?: string }>>('users.get', {
        user_ids: batch.join(','),
      });
      for (const user of users) if (user.first_name) names.set(user.id, user.first_name);
    }
    return names;
  }

  async getUserMemberships(userIds: number[]): Promise<Map<number, boolean>> {
    if (userIds.length === 0) return new Map();
    const result = await this.call<Array<{ user_id: number; member: number }> | number>(
      'groups.isMember',
      { group_id: this.config.groupId, user_ids: userIds.join(',') },
    );
    if (typeof result === 'number') return new Map([[userIds[0]!, result === 1]]);
    return new Map(result.map((entry) => [entry.user_id, entry.member === 1]));
  }

  /** Publica no tópico; com `replyToCommentId` nulo, o comentário não é uma resposta. */
  async createComment(
    topicId: number,
    replyToCommentId: number | null,
    message: string,
    operationId: string,
  ): Promise<number> {
    return this.call('board.createComment', {
      group_id: this.config.groupId,
      topic_id: topicId,
      ...(replyToCommentId === null ? {} : { reply_to_comment: replyToCommentId }),
      message,
      guid: deterministicGuid(operationId),
    });
  }

  /** Retorna false quando a abertura deve ser preservada e a escalação precisa de outro comentário. */
  async editOwnComment(topicId: number, comment: VkComment, message: string): Promise<boolean> {
    if (comment.can_edit === 0 || comment.from_id <= 0) return false;
    const attachments = attachmentReferences(comment);
    if (!attachments) return false;
    const [user] = await this.call<Array<{ id: number }>>('users.get', {});
    if (!user || !Number.isSafeInteger(user.id))
      throw new Error('Usuário do token VK indisponível');
    if (comment.from_id !== user.id) return false;
    try {
      // A VK substitui o texto inteiro. Após um timeout, o cron relê a abertura antes de tentar de novo.
      const result = await this.call<number>(
        'board.editComment',
        {
          group_id: this.groupId,
          topic_id: topicId,
          comment_id: comment.id,
          message,
          ...(attachments.length ? { attachments: attachments.join(',') } : {}),
        },
        this.config.accessToken,
        1,
      );
      if (result !== 1) throw new Error('Edição do comentário sem confirmação da VK');
      return true;
    } catch (error) {
      if (error instanceof VkApiError && [7, 15, 183, 600].includes(error.code)) return false;
      throw error;
    }
  }

  /**
   * Cria um tópico; o texto vira o primeiro comentário. `board.addTopic` não aceita `guid`,
   * então não há retentativa aqui: um timeout pode ter criado o tópico, e quem chama verifica
   * se ele já existe antes de tentar de novo.
   */
  async addTopic(title: string, text: string): Promise<number> {
    return this.call(
      'board.addTopic',
      { group_id: this.config.groupId, title, text },
      this.config.accessToken,
      1,
    );
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
    attempts = 3,
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
        attempts,
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

function attachmentReferences(comment: VkComment): string[] | null {
  const references: string[] = [];
  for (const attachment of comment.attachments ?? []) {
    const { type } = attachment;
    // A prévia de um endereço presente no texto é gerada pela própria VK.
    if (type === 'link' && attachment.link?.url && comment.text.includes(attachment.link.url))
      continue;
    if (type !== 'photo' && type !== 'video' && type !== 'audio' && type !== 'doc') return null;
    const media = attachment[type];
    if (!media || !Number.isSafeInteger(media.owner_id) || !Number.isSafeInteger(media.id))
      return null;
    references.push(
      `${type}${media.owner_id}_${media.id}${media.access_key ? '_' + media.access_key : ''}`,
    );
  }
  return references;
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
