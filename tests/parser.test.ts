import { describe, expect, it } from 'vitest';

import { calculateReminderDate, parseCommand } from '../src/commands/parser.js';

describe('parseCommand', () => {
  it.each([
    ['!camisa7', 'camisa7'],
    [' !GSD ', 'gsd'],
    ['!antizica', 'antizica'],
    ['!mongol', 'mongol'],
    ['!upem', 'upem'],
    ['!m', 'private-message'],
    ['!mensagem', 'private-message'],
    ['!tutorial', 'tutorial'],
  ])('reconhece %s', (input, kind) => {
    expect(parseCommand(input)?.kind).toBe(kind);
  });

  it('reconhece citação apenas no início', () => {
    expect(parseCommand('!c olá')).toEqual({ kind: 'quote', message: 'olá' });
    expect(parseCommand('texto !c olá')).toBeNull();
  });

  it.each(['!r', '!r 0 minutos', '!r -1 dias', '!r 1.5 horas', '!r 366 dias', '!r 1 século'])(
    'rejeita lembrete inválido: %s',
    (input) => expect(parseCommand(input)).toEqual({ kind: 'invalid-reminder' }),
  );

  it('aceita aliases e o limite de 365 dias', () => {
    expect(parseCommand('!remind 1 mês')).toMatchObject({
      kind: 'reminder',
      amount: 1,
      unit: 'mes',
    });
    expect(parseCommand('!r 365 dias')).toMatchObject({
      kind: 'reminder',
      amount: 365,
      unit: 'dia',
    });
  });

  it('calcula a data sem subtrair um segundo', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(calculateReminderDate(1, 'minuto', now).toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });
});
