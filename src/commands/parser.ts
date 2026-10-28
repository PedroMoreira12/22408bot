export type ReminderUnit = 'minuto' | 'hora' | 'dia' | 'mes';

export type AgendaScope =
  | { type: 'today' }
  | { type: 'tomorrow' }
  | { type: 'week' }
  | { type: 'botafogo' }
  /** Dia da semana: 0 = domingo, 6 = sábado. */
  | { type: 'weekday'; weekday: number }
  | { type: 'date'; day: number; month: number; year?: number };

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
  | { kind: 'round' }
  | { kind: 'result' }
  | { kind: 'lineup' }
  | { kind: 'prediction'; home: number; away: number }
  | { kind: 'prediction-status' }
  | { kind: 'prediction-list' }
  | { kind: 'invalid-prediction' }
  | { kind: 'prediction-ranking'; year?: number }
  | { kind: 'game-alert' }
  | { kind: 'cancel-game-alert' }
  | { kind: 'reminders' }
  | { kind: 'reminder'; amount: number; unit: ReminderUnit; displayUnit: string }
  | { kind: 'invalid-reminder' };

export type CommandKind = ParsedCommand['kind'];

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
const MAX_PREDICTION_GOALS = 20;

const WEEKDAY_ALIASES: Record<string, number> = {
  domingo: 0,
  dom: 0,
  segunda: 1,
  seg: 1,
  terca: 2,
  ter: 2,
  quarta: 3,
  qua: 3,
  quinta: 4,
  qui: 4,
  sexta: 5,
  sex: 5,
  sabado: 6,
  sab: 6,
};

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
    case 'ajuda':
    case 'comandos':
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
    case 'rodada':
      return { kind: 'round' };
    case 'resultado':
    case 'placar':
    case 'ultimo':
    case 'último':
    case 'ultimojogo':
    case 'últimojogo':
      return { kind: 'result' };
    case 'escalacao':
    case 'escalação':
      return { kind: 'lineup' };
    case 'palpite':
      return parsePrediction(argument);
    case 'palpites':
    case 'todospalpites':
      // `!palpites 2x1` é tratado como palpite, já que a intenção é clara.
      return argument ? parsePrediction(argument) : { kind: 'prediction-list' };
    case 'bolao':
    case 'bolão':
    case 'rankingpalpites':
    case 'rankingbolao':
    case 'rankingbolão':
      return parseYearOnly(argument, 'prediction-ranking');
    case 'avisar':
    case 'avisarjogo':
      return parseGameAlert(argument);
    case 'lembretes':
    case 'meuslembretes':
      return { kind: 'reminders' };
    case 'r':
    case 'remind':
      return parseReminder(argument);
    default: {
      const top = /^top(\d{1,2})$/u.exec(name ?? '');
      if (top) {
        const limit = Number(top[1]);
        if (limit < 1 || limit > 20) return null;
        return argument ? parseTop(`${limit} ${argument}`) : { kind: 'top', limit };
      }
      return null;
    }
  }
}

function parseYearOnly(
  argument: string,
  kind: 'stats' | 'sequence' | 'retrospective' | 'records' | 'prediction-ranking',
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
  const normalized = normalizeWord(argument);
  if (!normalized || normalized === 'hoje') return { kind: 'agenda', scope: { type: 'today' } };
  if (normalized === 'amanha') return { kind: 'agenda', scope: { type: 'tomorrow' } };
  if (normalized === 'semana') return { kind: 'agenda', scope: { type: 'week' } };
  if (['botafogo', 'bota', 'fogao'].includes(normalized)) {
    return { kind: 'agenda', scope: { type: 'botafogo' } };
  }

  const weekday = WEEKDAY_ALIASES[normalized.replace(/-?feira$/u, '')];
  if (weekday !== undefined) return { kind: 'agenda', scope: { type: 'weekday', weekday } };

  const date = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/u.exec(normalized);
  if (date) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    const year = date[3] ? Number(date[3].length === 2 ? `20${date[3]}` : date[3]) : undefined;
    if (!isValidDate(day, month, year ?? 2024)) return { kind: 'invalid-agenda' };
    return {
      kind: 'agenda',
      scope: { type: 'date', day, month, ...(year !== undefined ? { year } : {}) },
    };
  }
  return { kind: 'invalid-agenda' };
}

function parsePrediction(argument: string): ParsedCommand {
  if (!argument) return { kind: 'prediction-status' };
  const score = /^(\d{1,2})\s*(?:x|×|-|a)\s*(\d{1,2})$/iu.exec(argument);
  if (!score) return { kind: 'invalid-prediction' };
  const home = Number(score[1]);
  const away = Number(score[2]);
  if (home > MAX_PREDICTION_GOALS || away > MAX_PREDICTION_GOALS) {
    return { kind: 'invalid-prediction' };
  }
  return { kind: 'prediction', home, away };
}

function parseGameAlert(argument: string): ParsedCommand {
  const normalized = normalizeWord(argument);
  if (!normalized || normalized === 'jogo') return { kind: 'game-alert' };
  if (['cancelar', 'off', 'parar', 'nao'].includes(normalized)) {
    return { kind: 'cancel-game-alert' };
  }
  return { kind: 'game-alert' };
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

export function isValidDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeWord(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/\s+/gu, ' ');
}
