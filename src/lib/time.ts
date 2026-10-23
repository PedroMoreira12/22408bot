export const TIME_ZONE = 'America/Sao_Paulo';

// O Brasil não adota horário de verão desde 2019, então o fuso de São Paulo é fixo.
const SAO_PAULO_OFFSET = '-03:00';
const DAY_MILLISECONDS = 86_400_000;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function localParts(date: Date): LocalParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
  };
}

export function localDateKey(date: Date, dayOffset = 0): string {
  const parts = localParts(date);
  return dateKeyFromUtc(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset)));
}

export function localTime(date: Date): string {
  const parts = localParts(date);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localYear(date: Date): number {
  return localParts(date).year;
}

export function addDays(dateKey: string, days: number): string {
  return dateKeyFromUtc(new Date(utcMidnight(dateKey) + days * DAY_MILLISECONDS));
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((utcMidnight(toKey) - utcMidnight(fromKey)) / DAY_MILLISECONDS);
}

export function weekdayOf(dateKey: string): number {
  return new Date(utcMidnight(dateKey)).getUTCDay();
}

export function weekdayName(dateKey: string): string {
  return WEEKDAYS[weekdayOf(dateKey)] ?? '';
}

export function isValidDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && addDays(dateKey, 0) === dateKey;
}

export function isLastDayOfMonth(dateKey: string): boolean {
  return addDays(dateKey, 1).slice(5, 7) !== dateKey.slice(5, 7);
}

export function saoPauloDate(dateKey: string, time = '00:00'): Date {
  return new Date(`${dateKey}T${time}:00${SAO_PAULO_OFFSET}`);
}

export function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return year && month && day ? `${day}/${month}/${year}` : dateKey;
}

export function formatShortDateKey(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return month && day ? `${day}/${month}` : dateKey;
}

export function formatCountdown(from: Date, to: Date): string | null {
  const totalMinutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (totalMinutes <= 0) return null;
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} dia${days > 1 ? 's' : ''}${hours > 0 ? ` e ${hours}h` : ''}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? pad(minutes) : ''}`;
  return `${minutes} min`;
}

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function utcMidnight(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function dateKeyFromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
