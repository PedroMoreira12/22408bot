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
    ['!stats', 'stats'],
    ['!sequencia', 'sequence'],
    ['!retrospectiva', 'retrospective'],
    ['!recordes', 'records'],
  ])('reconhece %s', (input, kind) => {
    expect(parseCommand(input)?.kind).toBe(kind);
  });

  it('usa defaults e aceita limites compactos no ranking', () => {
    expect(parseCommand('!top')).toEqual({ kind: 'top', limit: 20 });
    expect(parseCommand('!top 5')).toEqual({ kind: 'top', limit: 5 });
    expect(parseCommand('!top5')).toEqual({ kind: 'top', limit: 5 });
    expect(parseCommand('!top20')).toEqual({ kind: 'top', limit: 20 });
    expect(parseCommand('!top 2024')).toEqual({ kind: 'top', limit: 20, year: 2024 });
    expect(parseCommand('!top 5 2025')).toEqual({ kind: 'top', limit: 5, year: 2025 });
    expect(parseCommand('!stats 2025')).toEqual({ kind: 'stats', year: 2025 });
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

  it.each(['!jogo', '!proximo', '!próximo', '!proximojogo', '!próximojogo'])(
    'reconhece alias de jogo: %s',
    (input) => expect(parseCommand(input)).toEqual({ kind: 'game' }),
  );

  it.each(['!tabela', '!classificacao', '!classificação', '!brasileirao', '!brasileirão'])(
    'reconhece alias da tabela: %s',
    (input) => expect(parseCommand(input)).toEqual({ kind: 'table' }),
  );

  it('reconhece as variações da agenda', () => {
    expect(parseCommand('!agenda')).toEqual({ kind: 'agenda', scope: { type: 'today' } });
    expect(parseCommand('!agenda AMANHÃ')).toEqual({ kind: 'agenda', scope: { type: 'tomorrow' } });
    expect(parseCommand('!agenda botafogo')).toEqual({
      kind: 'agenda',
      scope: { type: 'botafogo' },
    });
    expect(parseCommand('!agenda semana')).toEqual({ kind: 'agenda', scope: { type: 'week' } });
    expect(parseCommand('!agenda Sábado')).toEqual({
      kind: 'agenda',
      scope: { type: 'weekday', weekday: 6 },
    });
    expect(parseCommand('!agenda segunda-feira')).toEqual({
      kind: 'agenda',
      scope: { type: 'weekday', weekday: 1 },
    });
    expect(parseCommand('!agenda 25/10')).toEqual({
      kind: 'agenda',
      scope: { type: 'date', day: 25, month: 10 },
    });
    expect(parseCommand('!agenda 01/02/27')).toEqual({
      kind: 'agenda',
      scope: { type: 'date', day: 1, month: 2, year: 2027 },
    });
    expect(parseCommand('!agenda 31/02')).toEqual({ kind: 'invalid-agenda' });
    expect(parseCommand('!agenda ontem')).toEqual({ kind: 'invalid-agenda' });
  });

  it.each([
    ['!rodada', { kind: 'round' }],
    ['!resultado', { kind: 'result' }],
    ['!último', { kind: 'result' }],
    ['!escalação', { kind: 'lineup' }],
    ['!palpite', { kind: 'prediction-status' }],
    ['!palpite 2x1', { kind: 'prediction', home: 2, away: 1 }],
    ['!palpite 0 X 3', { kind: 'prediction', home: 0, away: 3 }],
    ['!palpite 1-1', { kind: 'prediction', home: 1, away: 1 }],
    ['!palpite 21x0', { kind: 'invalid-prediction' }],
    ['!palpite botafogo', { kind: 'invalid-prediction' }],
    ['!bolao', { kind: 'prediction-ranking' }],
    ['!bolão 2026', { kind: 'prediction-ranking', year: 2026 }],
    ['!avisar', { kind: 'game-alert' }],
    ['!avisar jogo', { kind: 'game-alert' }],
    ['!avisar cancelar', { kind: 'cancel-game-alert' }],
    ['!ajuda', { kind: 'tutorial' }],
    ['!top21', null],
  ])('reconhece %s', (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it.each(['!lembretes', '!meuslembretes'])('reconhece listagem de lembretes: %s', (input) => {
    expect(parseCommand(input)).toEqual({ kind: 'reminders' });
  });
});
