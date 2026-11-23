import { describe, expect, it, vi } from 'vitest';

import { deterministicGuid, deterministicRandomId, VkClient } from '../src/clients/vk.js';
import type { VkComment } from '../src/clients/vk.js';

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

  const opening: VkComment = {
    id: 82,
    from_id: 51,
    date: 12,
    text: 'Abertura https://www.cbf.com.br/jogo',
  };
  it('edita o ID do comentário com o token do autor e mantém os anexos identificáveis', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ response: [{ id: 51 }] }))
      .mockResolvedValueOnce(jsonResponse({ response: 1 }));
    const client = new VkClient(config, { fetchImpl, requestSpacingMs: 0 });
    const message = opening.text + '\n\nEscalação';
    expect(
      await client.editOwnComment(
        10,
        {
          ...opening,
          attachments: [
            { type: 'link', link: { url: 'https://www.cbf.com.br/jogo' } },
            { type: 'photo', photo: { owner_id: -8, id: 4, access_key: 'abc' } },
            { type: 'doc', doc: { owner_id: 51, id: 6 } },
          ],
        },
        message,
      ),
    ).toBe(true);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe('https://api.vk.com/method/board.editComment');
    expect(Object.fromEntries(init?.body as URLSearchParams)).toMatchObject({
      group_id: '123',
      topic_id: '10',
      comment_id: '82',
      message,
      attachments: 'photo-8_4_abc,doc51_6',
      access_token: config.accessToken,
    });
  });

  it('preserva comentários alheios, sem permissão ou com anexo que não pode reenviar', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ response: [{ id: 99 }] }));
    const client = new VkClient(config, { fetchImpl, requestSpacingMs: 0 });
    expect(await client.editOwnComment(10, { ...opening, can_edit: 0 }, 'novo')).toBe(false);
    expect(
      await client.editOwnComment(10, { ...opening, attachments: [{ type: 'sticker' }] }, 'novo'),
    ).toBe(false);
    expect(await client.editOwnComment(10, { ...opening, can_edit: 1 }, 'novo')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.vk.com/method/users.get');
  });

  it('diferencia recusa de permissão, erro transitório e resposta de edição inválida', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new VkClient(config, { fetchImpl, requestSpacingMs: 0 });
    for (const result of [
      jsonResponse({ error: { error_code: 15, error_msg: 'Access denied' } }),
      jsonResponse({}, 502),
      jsonResponse({ response: 0 }),
    ])
      fetchImpl
        .mockResolvedValueOnce(jsonResponse({ response: [{ id: 51 }] }))
        .mockResolvedValueOnce(result);
    await expect(client.editOwnComment(10, opening, 'novo')).resolves.toBe(false);
    await expect(client.editOwnComment(10, opening, 'novo')).rejects.toThrow('HTTP 502');
    await expect(client.editOwnComment(10, opening, 'novo')).rejects.toThrow('sem confirmação');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
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

  it('não repete a criação de tópico, que não tem guid', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 502));
    const client = new VkClient(config, {
      fetchImpl: fetchMock,
      requestSpacingMs: 0,
      sleep: () => Promise.resolve(),
    });

    await expect(client.addTopic('Bolão', 'texto')).rejects.toThrow('HTTP 502');
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('group_id')).toBe('123');
    expect(body.get('title')).toBe('Bolão');
    expect(body.get('text')).toBe('texto');
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
