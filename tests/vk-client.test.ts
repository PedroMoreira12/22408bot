import { describe, expect, it, vi } from 'vitest';

import { deterministicGuid, deterministicRandomId, VkClient } from '../src/clients/vk.js';

const config = {
  accessToken: 'user-secret-token',
  communityAccessToken: 'community-secret-token',
  apiVersion: '5.199',
  groupId: 123,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VkClient', () => {
  it('usa POST e parâmetros idempotentes determinísticos', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ response: 42 }));
    const client = new VkClient(config, { fetchImpl: fetchMock, requestSpacingMs: 0 });

    await client.createComment(10, 20, 'resposta', 'operation-1');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init?.body as URLSearchParams).get('guid')).toBe(deterministicGuid('operation-1'));
    expect(deterministicRandomId('operation-1')).toBe(deterministicRandomId('operation-1'));
    expect(deterministicRandomId('operation-1')).toBeGreaterThan(0);
  });

  it('publica sem resposta quando não há comentário de origem', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ response: 43 }));
    const client = new VkClient(config, { fetchImpl: fetchMock, requestSpacingMs: 0 });

    await client.createComment(10, null, 'feed', 'operation-2');
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has('reply_to_comment')).toBe(false);
    expect(body.get('topic_id')).toBe('10');
  });

  it('busca vários nomes em uma única chamada', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        response: [
          { id: 1, first_name: 'Ana' },
          { id: 2, first_name: 'Bia' },
        ],
      }),
    );
    const client = new VkClient(config, { fetchImpl: fetchMock, requestSpacingMs: 0 });

    const names = await client.getUserFirstNames([1, 2, 2, -5]);
    expect(names).toEqual(
      new Map([
        [1, 'Ana'],
        [2, 'Bia'],
      ]),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams).get('user_ids')).toBe('1,2');
  });

  it('repete falhas transitórias e recupera', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { error_code: 6, error_msg: 'rate limit' } }))
      .mockResolvedValueOnce(jsonResponse({ response: { count: 0, items: [] } }));
    const client = new VkClient(config, {
      fetchImpl: fetchMock,
      requestSpacingMs: 0,
      sleep: () => Promise.resolve(),
    });

    await expect(client.getTopics()).resolves.toMatchObject({ count: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('não inclui tokens no erro', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { error_code: 5, error_msg: 'invalid token' } }));
    const client = new VkClient(config, { fetchImpl: fetchMock, requestSpacingMs: 0 });

    const error = await client.getTopics().catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(config.accessToken);
    expect(String(error)).not.toContain(config.communityAccessToken);
  });
});
