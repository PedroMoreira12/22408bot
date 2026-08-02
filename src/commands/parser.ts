export type ReminderUnit = 'minuto' | 'hora' | 'dia' | 'mes';
export type AgendaScope = 'today' | 'tomorrow' | 'botafogo';

export type ParsedCommand =
  | { kind: 'camisa7' }
  | { kind: 'quote'; message: string }
  | { kind: 'gsd' }
  | { kind: 'antizica' }
  | { kind: 'mongol' }
  | { kind: 'upem' }
  | { kind: 'private-message' }
  | { kind: 'tutorial' }
  | { kind: 'game' }
  | { kind: 'agenda'; scope: AgendaScope }
  | { kind: 'invalid-agenda' }
  | { kind: 'table' }
  | { kind: 'reminders' }
  | { kind: 'reminder'; amount: number; unit: ReminderUnit; displayUnit: string }
  | { kind: 'invalid-reminder' };

const UNIT_ALIASES: Record<string, ReminderUnit> = {
  minuto: 'minuto',
  minutos: 'minuto',
  hora: 'hora',
  horas: 'hora',
  dia: 'dia',
  dias: 'dia',
  mes: 'mes',
  mês: 'mes',
  meses: 'mes',
};

const UNIT_MILLISECONDS: Record<ReminderUnit, number> = {
  minuto: 60_000,
  hora: 3_600_000,
  dia: 86_400_000,
  mes: 30 * 86_400_000,
};

const MAX_REMINDER_MILLISECONDS = 365 * 86_400_000;

export function parseCommand(text: string): ParsedCommand | null {
  const match = /^!(\S+)(?:\s+(.*))?$/su.exec(text.trim());
  if (!match) return null;

  const name = match[1]?.toLocaleLowerCase('pt-BR');
  const argument = match[2]?.trim() ?? '';
  switch (name) {
    case 'camisa7':
      return { kind: 'camisa7' };
    case 'c':
      return { kind: 'quote', message: argument };
    case 'gsd':
      return { kind: 'gsd' };
    case 'antizica':
      return { kind: 'antizica' };
    case 'mongol':
      return { kind: 'mongol' };
    case 'upem':
      return { kind: 'upem' };
    case 'm':
    case 'mensagem':
      return { kind: 'private-message' };
    case 'tutorial':
      return { kind: 'tutorial' };
    case 'jogo':
    case 'proximo':
    case 'próximo':
    case 'proximojogo':
    case 'próximojogo':
      return { kind: 'game' };
    case 'agenda':
      return parseAgenda(argument);
    case 'tabela':
    case 'classificacao':
    case 'classificação':
    case 'brasileirao':
    case 'brasileirão':
      return { kind: 'table' };
    case 'lembretes':
    case 'meuslembretes':
      return { kind: 'reminders' };
    case 'r':
    case 'remind':
      return parseReminder(argument);
    default:
      return null;
  }
}

function parseAgenda(argument: string): ParsedCommand {
  const normalized = argument.toLocaleLowerCase('pt-BR');
  if (!normalized) return { kind: 'agenda', scope: 'today' };
  if (normalized === 'amanha' || normalized === 'amanhã') {
    return { kind: 'agenda', scope: 'tomorrow' };
  }
  if (normalized === 'botafogo') return { kind: 'agenda', scope: 'botafogo' };
  return { kind: 'invalid-agenda' };
}

function parseReminder(argument: string): ParsedCommand {
  const parts = argument.toLocaleLowerCase('pt-BR').split(/\s+/u);
  if (parts.length !== 2) return { kind: 'invalid-reminder' };
  const [rawAmount, rawUnit] = parts;
  if (!rawAmount || !rawUnit || !/^\d+$/u.test(rawAmount)) return { kind: 'invalid-reminder' };

  const amount = Number(rawAmount);
  const unit = UNIT_ALIASES[rawUnit];
  if (!Number.isSafeInteger(amount) || amount <= 0 || !unit) return { kind: 'invalid-reminder' };
  if (amount * UNIT_MILLISECONDS[unit] > MAX_REMINDER_MILLISECONDS) {
    return { kind: 'invalid-reminder' };
  }
  return { kind: 'reminder', amount, unit, displayUnit: rawUnit };
}

export function calculateReminderDate(amount: number, unit: ReminderUnit, now = new Date()): Date {
  return new Date(now.getTime() + amount * UNIT_MILLISECONDS[unit]);
}
