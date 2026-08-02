declare module 'campeonato-brasileiro-api' {
  export interface CompetitionOptions {
    fetch?: typeof fetch;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }

  export function getCompetition(serie: string, options?: CompetitionOptions): Promise<unknown>;
}
