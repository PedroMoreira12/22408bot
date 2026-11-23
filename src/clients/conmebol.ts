import { parse } from 'node-html-parser';

import { createCache, fetchText } from './http.js';
import { clubKey, type OfficialMatchSheet, type SheetFixture } from '../football/match-sheet.js';
import { localDateKey } from '../lib/time.js';

const SITE = 'https://gol.conmebol.com';
const tournaments: Record<string, string> = {
  Libertadores: 'libertadores',
  'Sul-Americana': 'sudamericana',
};

/** Página oficial do Botafogo (clube 4), seguida pela central daquela partida. */
export class ConmebolClient {
  private readonly pages;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.pages = createCache(60_000, (path) =>
      fetchText(SITE + path, { context: 'CONMEBOL', fetchImpl, attempts: 1, timeoutMs: 3000 }),
    );
  }

  async getSheet(fixture: SheetFixture): Promise<OfficialMatchSheet | null> {
    const tournament = tournaments[fixture.competition];
    if (!tournament) return null;
    const base = `/${tournament}/pt-br`;
    const team = parse(await this.pages.get(`${base}/team/4`));
    const cards = team.querySelectorAll('[data-fixture-id][data-start-time]').filter((card) => {
      const [home, away] = card
        .querySelectorAll('.m-fixture-teaser-card__team-name')
        .map((name) => name.text.trim());
      const kickoff = new Date(Number(card.getAttribute('data-start-time')) * 1000);
      return (
        home &&
        away &&
        Number.isFinite(kickoff.getTime()) &&
        localDateKey(kickoff) === fixture.date &&
        clubKey(home) === clubKey(fixture.home) &&
        clubKey(away) === clubKey(fixture.away)
      );
    });
    const ids = new Set(cards.map((card) => card.getAttribute('data-fixture-id')));
    const id = cards[0]?.getAttribute('data-fixture-id');
    if (!id || !/^\d+$/u.test(id) || ids.size !== 1) return null;
    const path = `${base}/fixture/view/${id}`;
    const page = parse(await this.pages.get(path));
    const hero = page.querySelector(
      `[data-fixture-id="${id}"][data-display-mode="match_centre_hero"]`,
    );
    if (!hero) return null;
    const time = Number(hero.getAttribute('data-start-time'));
    const scheduled =
      time > 0 &&
      hero.getAttribute('data-tbc') === '0' &&
      !/postponed|cancelled|suspended/iu.test(hero.getAttribute('data-match-status') ?? '');
    const value = (field: string) =>
      page
        .querySelector(
          `.m-match-fixture-details__list-item--${field} .m-match-fixture-details__list-item-value`,
        )
        ?.text.trim() || null;
    return {
      source: 'CONMEBOL',
      url: SITE + path,
      kickoffAt: scheduled ? new Date(time * 1000) : null,
      venue: value('venue'),
      phase: null,
      broadcasts: [],
      referee: value('referee'),
      starters: [],
    };
  }
}
