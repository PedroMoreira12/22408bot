const TIME_ZONE = 'America/Sao_Paulo';

export const ACTIVITY_BACKFILL_CUTOFF = new Date('2026-01-01T03:00:00.000Z');

export interface ActivityDate {
  year: number;
  dateKey: string;
}

export function activityDate(date: Date): ActivityDate {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = Number(values.year);
  const month = values.month;
  const day = values.day;
  if (!Number.isInteger(year) || !month || !day) {
    throw new Error('Não foi possível determinar a data da atividade');
  }
  return { year, dateKey: `${year}-${month}-${day}` };
}
