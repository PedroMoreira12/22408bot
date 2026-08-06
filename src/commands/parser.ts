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
  | { kind: 'stats'; year?: number }
  | { kind: 'top'; limit: number; year?: number }
  | { kind: 'sequence'; year?: number }
  | { kind: 'retrospective'; year?: number }
  | { kind: 'records'; year?: number }
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
    case 'stats':
    case 'estatisticas':
    case 'estatísticas':
      return parseYearOnly(argument, 'stats');
    case 'sequencia':
    case 'sequência':
      return parseYearOnly(argument, 'sequence');
    case 'retrospectiva':
      return parseYearOnly(argument, 'retrospective');
    case 'recordes':
    case 'recordesdoano':
      return parseYearOnly(argument, 'records');
    case 'top':
      return parseTop(argument);
    case 'top1':
    case 'top2':
    case 'top3':
    case 'top4':
    case 'top5':
    case 'top6':
    case 'top7':
    case 'top8':
    case 'top9':
    case 'top10':
    case 'top11':
    case 'top12':
    case 'top13':
    case 'top14':
    case 'top15':
    case 'top16':
    case 'top17':
    case 'top18':
    case 'top19':
    case 'top20': {
      const limit = Number(name.slice(3));
      return argument ? parseTop(`${limit} ${argument}`) : { kind: 'top', limit };
    }
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

function parseYearOnly(
  argument: string,
  kind: 'stats' | 'sequence' | 'retrospective' | 'records',
): ParsedCommand {
  if (!argument) return { kind };
  if (!/^\d{4}$/u.test(argument)) return { kind, year: Number.NaN };
  return { kind, year: Number(argument) };
}

function parseTop(argument: string): ParsedCommand {
  if (!argument) return { kind: 'top', limit: 20 };
  const parts = argument.split(/\s+/u);
  if (parts.length > 2 || parts.some((part) => !/^\d{1,4}$/u.test(part))) {
    return { kind: 'top', limit: Number.NaN };
  }
  const first = Number(parts[0]);
  const second = parts[1] ? Number(parts[1]) : undefined;
  if (parts.length === 1 && first >= 1900 && first <= 2100) {
    return { kind: 'top', limit: 20, year: first };
  }
  return { kind: 'top', limit: first, ...(second !== undefined ? { year: second } : {}) };
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
