import type { AgendaScope, ParsedCommand } from './parser.js';

const DEFAULT_COOLDOWN_MILLISECONDS = 60_000;
const HEAVY_COOLDOWN_MILLISECONDS = 3 * 60_000;

export interface CommandCooldown {
  key: string;
  milliseconds: number;
}

/**
 * Intervalo mínimo entre consultas iguais do mesmo autor. Comandos que gravam algo (palpite,
 * lembrete, aviso) ou que são brincadeiras da comunidade não têm cooldown.
 */
export function commandCooldown(command: ParsedCommand): CommandCooldown | null {
  switch (command.kind) {
    case 'top':
      return heavy(`top:${command.limit}:${command.year ?? ''}`);
    case 'retrospective':
    case 'records':
      return heavy(`${command.kind}:${command.year ?? ''}`);
    case 'stats':
    case 'sequence':
    case 'prediction-ranking':
      return regular(`${command.kind}:${command.year ?? ''}`);
    case 'agenda':
      return regular(`agenda:${agendaKey(command.scope)}`);
    case 'camisa7':
    case 'game':
    case 'table':
    case 'round':
    case 'result':
    case 'lineup':
    case 'tutorial':
    case 'reminders':
    case 'prediction-status':
      return regular(command.kind);
    default:
      return null;
  }
}

function agendaKey(scope: AgendaScope): string {
  switch (scope.type) {
    case 'weekday':
      return `weekday-${scope.weekday}`;
    case 'date':
      return `date-${scope.day}-${scope.month}-${scope.year ?? ''}`;
    default:
      return scope.type;
  }
}

function regular(key: string): CommandCooldown {
  return { key, milliseconds: DEFAULT_COOLDOWN_MILLISECONDS };
}

function heavy(key: string): CommandCooldown {
  return { key, milliseconds: HEAVY_COOLDOWN_MILLISECONDS };
}
