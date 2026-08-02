import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateOne: vi.fn() }));
vi.mock('../src/models/job-state.js', () => ({ JobState: { updateOne: mocks.updateOne } }));

import { hasValidBearerToken } from '../src/http/auth.js';
import { acquireJobLease } from '../src/jobs/lease.js';

describe('autenticação do cron', () => {
  it('aceita somente o bearer token exato', () => {
    expect(
      hasValidBearerToken(
        new Request('https://example.test', {
          headers: { authorization: 'Bearer segredo-correto' },
        }),
        'segredo-correto',
      ),
    ).toBe(true);
    expect(hasValidBearerToken(new Request('https://example.test'), 'segredo-correto')).toBe(false);
  });
});

describe('lease global', () => {
  it('adquire um lease livre', async () => {
    mocks.updateOne.mockResolvedValueOnce({
      acknowledged: true,
      modifiedCount: 1,
      upsertedCount: 0,
    });
    await expect(acquireJobLease('owner', new Date())).resolves.toBe(true);
  });

  it('trata chave duplicada como execução concorrente', async () => {
    mocks.updateOne.mockRejectedValueOnce({ code: 11000 });
    await expect(acquireJobLease('owner', new Date())).resolves.toBe(false);
  });
});
