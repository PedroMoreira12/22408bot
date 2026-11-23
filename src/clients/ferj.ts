import { parse } from 'node-html-parser';

import { createCache, fetchText } from './http.js';
import {
  clubKey,
  normalizedName,
  startingEleven,
  type OfficialMatchSheet,
  type SheetFixture,
} from '../football/match-sheet.js';
import { formatDateKey, saoPauloDate } from '../lib/time.js';
import { log } from '../lib/logger.js';

const SITE = 'https://www.fferj.com.br';
const CLUB = 'S.A.F Botafogo';
const competitionIds: Record<string, string> = {
  Carioca: '2',
  'Sul-Americana': '43',
  Libertadores: '13',
};

/** A central publica os titulares por clube, em uma lista separada dos reservas. */
export class FerjClient {
  private readonly pages;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.pages = createCache(45_000, (path) =>
      fetchText(SITE + path, { context: 'FERJ', fetchImpl, attempts: 1, timeoutMs: 3000 }),
    );
  }

  async getSheet(fixture: SheetFixture): Promise<OfficialMatchSheet | null> {
    const championship = competitionIds[fixture.competition];
    if (!championship) return null;
    const [year, month] = fixture.date.split('-');
    const params = new URLSearchParams({
      clubeId: '25',
      campeonatoId: championship,
      genero: 'MASCULINO',
      visao: 'mes',
      ano: year!,
      mes: String(Number(month)),
    });
    if (fixture.competition === 'Carioca') params.set('categoriaId', '1');
    const calendar = parse(await this.pages.get(`/partidas?${params.toString()}`));
    const day = calendar.querySelector(`section[aria-labelledby="dia-${fixture.date}"]`);
    const matches = (
      day?.querySelectorAll('article a[aria-label][href^="/partidas/"]') ?? []
    ).filter((anchor) => {
      const label = anchor.getAttribute('aria-label')?.replace(/^Ver a partida /u, '');
      const [home, away] = label?.split(/\s+[x×]\s+/iu) ?? [];
      if (!home || !away) return false;
      return fixture.botafogoHome
        ? home === CLUB && clubKey(away) === clubKey(fixture.away)
        : away === CLUB && clubKey(home) === clubKey(fixture.home);
    });
    const path = matches[0]?.getAttribute('href');
    if (!path || !/^\/partidas\/\d+$/u.test(path) || matches.length !== 1) return null;

    const [lineup, refs] = await Promise.all([
      this.pages.get(path + '?aba=escalacao'),
      this.pages.get(path + '?aba=arbitragem').catch((error: unknown) => {
        log('warn', 'ferj.referee_failed', { path, error });
        return '';
      }),
    ]);
    const page = parse(lineup);
    const header = page.querySelector('section[aria-label="Placar da partida"]');
    const when = header
      ?.querySelectorAll('span')
      .find((span) => /\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/u.test(span.text.trim()));
    if (!when?.text.trim().includes(formatDateKey(fixture.date))) return null;
    const time = when.text.trim().slice(-5);
    const postponed = /ADIAD[AO]|SUSPENS[AO]|CANCELAD[AO]/iu.test(header?.text ?? '');
    const selected = page.querySelector(`section[aria-label="Escalação ${CLUB}"]`);
    const heading = selected
      ?.querySelectorAll('h3')
      .find((h) => normalizedName(h.text.trim()) === 'titulares');
    const names =
      heading?.nextElementSibling
        ?.querySelectorAll('li')
        .map((row) => row.querySelectorAll('span').at(-1)?.text.trim() ?? '') ?? [];
    const refereeRow = parse(refs)
      .querySelectorAll('section[aria-label="Arbitragem"] li')
      .find((li) => normalizedName(li.querySelector('span')?.text.trim() ?? '') === 'arbitro');
    return {
      source: 'FERJ',
      url: SITE + path,
      kickoffAt: postponed ? null : saoPauloDate(fixture.date, time),
      phase: null,
      venue: when.nextElementSibling?.text.trim() || null,
      broadcasts: [],
      referee: refereeRow?.querySelector('span.break-words')?.text.trim() || null,
      starters: startingEleven(names),
    };
  }
}
