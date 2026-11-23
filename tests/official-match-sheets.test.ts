import { describe, expect, it, vi } from 'vitest';

import { CbfClient } from '../src/clients/cbf.js';
import { ConmebolClient } from '../src/clients/conmebol.js';
import { FerjClient } from '../src/clients/ferj.js';
import type { SheetFixture } from '../src/football/match-sheet.js';

const fixture: SheetFixture = {
  competition: 'Brasileirão Série A',
  date: '2026-11-23',
  time: '20:00',
  home: 'Botafogo',
  away: 'São Paulo',
  botafogoHome: true,
};
const home = { id: '60175', nome: 'Botafogo' };
const away = { id: '20005', nome: 'São Paulo' };
const game = {
  id_jogo: '832242',
  data: ' 23/11/2026',
  hora: '20:00',
  rodada: '36',
  mandante: home,
  visitante: away,
  local: 'Nilton Santos - Rio de Janeiro - RJ',
  transmissoes: [{ nome: 'Amazon Prime' }],
};
const eleven = Array.from({ length: 11 }, (_, i) => ({
  id: String(i + 1),
  apelido: `${i + 1} - Titular ${i + 1}`,
  reserva: 'false',
}));
const rival = eleven.map((athlete, i) => ({
  ...athlete,
  id: String(i + 20),
  apelido: `Rival ${i + 1}`,
}));
const calendar = { jogos: { 'Campeonato Brasileiro': { 'Série A': [game], 'Sub-20': [game] } } };
const details = {
  ...game,
  mandante: { ...home, atletas: [{ id: '12', apelido: 'Reserva', reserva: 'true' }, ...eleven] },
  visitante: {
    ...away,
    atletas: [...rival, { id: '40', apelido: 'Reserva adversário', reserva: 'true' }],
  },
  arbitros: [
    { nome: 'Assistente', funcao: 'Arbitro Assistente 1', uf: 'RJ' },
    { nome: 'Andre Luiz Skettino Policarpo Bento', funcao: 'Arbitro', uf: 'MG' },
  ],
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString();
}

function cbf(day: unknown, match: unknown) {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation((url) =>
      Promise.resolve(
        requestUrl(url).includes('/calendario/')
          ? Response.json(day)
          : Response.json({ jogo: match }),
      ),
    );
  return { client: new CbfClient(fetchImpl), fetchImpl };
}

describe('ficha oficial da CBF', () => {
  it('descobre o ID da partida pelo calendário profissional, com local, rodada, TV e árbitro principal', async () => {
    const { client, fetchImpl } = cbf(calendar, details);
    const [match] = await client.getBotafogoMatches(fixture.date);
    expect(match).toMatchObject({
      id: 'cbf:832242',
      phase: '36ª rodada',
      kickoffAt: '2026-11-23T23:00:00.000Z',
      status: 'scheduled',
    });
    const sheet = await client.getSheet(fixture);
    expect(sheet).toMatchObject({
      source: 'CBF',
      phase: '36ª rodada',
      venue: 'Estádio Nilton Santos, Rio de Janeiro (RJ)',
      broadcasts: [{ name: 'Prime Video', kind: 'paid-streaming' }],
      referee: 'Andre Luiz Skettino Policarpo Bento (MG)',
      starters: eleven.map((_, i) => `Titular ${i + 1}`),
      opponentStarters: rival.map((athlete) => athlete.apelido),
      url: 'https://www.cbf.com.br/futebol-brasileiro/jogos/campeonato-brasileiro/serie-a/2026/botafogo-x-sao-paulo/832242',
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://www.cbf.com.br/api/cbf/calendario/jogos/2026/11/23',
      'https://www.cbf.com.br/api/cbf/jogos/832242',
    ]);
  });

  it('seleciona o Botafogo visitante e usa canais diferentes quando a ficha foi atualizada', async () => {
    const reversed = { ...game, mandante: away, visitante: home };
    const { client } = cbf(
      { jogos: { 'Campeonato Brasileiro': { 'Série A': [reversed] } } },
      {
        ...reversed,
        mandante: details.visitante,
        visitante: details.mandante,
        canais: 'Globo, Premiere',
      },
    );
    const sheet = await client.getSheet({
      ...fixture,
      home: 'São Paulo',
      away: 'Botafogo',
      botafogoHome: false,
    });
    expect(sheet?.starters).toEqual(eleven.map((_, i) => `Titular ${i + 1}`));
    expect(sheet?.opponentStarters).toEqual(rival.map((athlete) => athlete.apelido));
    expect(sheet?.broadcasts.map((item) => item.name)).toEqual(['Globo', 'Premiere']);
  });

  it('descarta lista parcial, reserva e jogador duplicado e preserva os demais dados se o detalhe falhar', async () => {
    for (const players of [
      [],
      eleven.slice(0, 10),
      [...eleven.slice(0, 10), eleven[0]],
      [...eleven, { ...eleven[10], id: '22' }],
    ]) {
      const sheet = await cbf(calendar, {
        ...details,
        mandante: { ...home, atletas: players },
      }).client.getSheet(fixture);
      expect(sheet?.starters).toEqual([]);
      expect(sheet?.opponentStarters).toEqual(rival.map((athlete) => athlete.apelido));
    }
    const incomplete = await cbf(calendar, {}).client.getSheet(fixture);
    expect(incomplete).toMatchObject({
      phase: '36ª rodada',
      referee: null,
      broadcasts: [{ name: 'Prime Video' }],
      starters: [],
      opponentStarters: [],
    });
  });

  it('exige a competição, o mandante e o adversário corretos; horário a definir não autoriza abertura', async () => {
    expect(await cbf(calendar, details).client.getSheet({ ...fixture, away: 'Santos' })).toBeNull();
    expect(
      await cbf(
        { jogos: { 'Campeonato Brasileiro': { 'Sub-20': [game] } } },
        details,
      ).client.getSheet(fixture),
    ).toBeNull();
    expect(
      (await cbf(calendar, { ...details, hora: 'A definir' }).client.getSheet(fixture))?.kickoffAt,
    ).toBeNull();
    const homonym = { ...game, mandante: { nome: 'Botafogo', id: '99999' } };
    expect(
      await cbf(
        { jogos: { 'Campeonato Brasileiro': { 'Série A': [homonym] } } },
        details,
      ).client.getSheet(fixture),
    ).toBeNull();
  });
});

describe('fichas do Carioca e da CONMEBOL', () => {
  it('lê os blocos TITULARES de cada clube na página exata da FERJ', async () => {
    const listing =
      '<section aria-labelledby="dia-2026-02-15"><article><a aria-label="Ver a partida S.A.F Botafogo x C.R Flamengo" href="/partidas/3700"></a></article></section>';
    const list = (prefix: string) =>
      '<ol>' +
      eleven
        .map((_, i) => `<li><span>${i + 1}</span><span>${prefix} ${i + 1}</span></li>`)
        .join('') +
      '</ol>';
    const header =
      '<section aria-label="Placar da partida"><div><span>Domingo, 15/02/2026 · 17:30</span><span>Nilton Santos</span></div></section>';
    const lineup =
      header +
      `<section aria-label="Escalação C.R Flamengo"><h3>TITULARES</h3>${list('Rival')}<h3>RESERVAS</h3>${list('Banco rival')}</section><section aria-label="Escalação S.A.F Botafogo"><h3>TITULARES</h3>${list('Titular')}<h3>RESERVAS</h3>${list('Reserva')}</section>`;
    const ref =
      '<section aria-label="Arbitragem"><ul><li><span>Árbitro</span><span class="break-words">BRUNO ARLEU DE ARAÚJO</span></li></ul></section>';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          new Response(
            requestUrl(url).includes('aba=escalacao')
              ? lineup
              : requestUrl(url).includes('aba=arbitragem')
                ? ref
                : listing,
          ),
        ),
      );
    const client = new FerjClient(fetchImpl);
    const carioca = {
      ...fixture,
      competition: 'Carioca',
      date: '2026-02-15',
      time: '17:30',
      away: 'Flamengo',
    };
    expect(await client.getSheet(carioca)).toMatchObject({
      source: 'FERJ',
      venue: 'Nilton Santos',
      referee: 'BRUNO ARLEU DE ARAÚJO',
      starters: eleven.map((_, i) => `Titular ${i + 1}`),
      opponentStarters: rival.map((athlete) => athlete.apelido),
    });
    expect(await client.getSheet({ ...carioca, away: 'Vasco' })).toBeNull();
  });

  it('valida a competição, o mando e a data local na central oficial da CONMEBOL', async () => {
    const attributes = 'data-fixture-id="1596" data-start-time="1787272200"';
    const listing = `<article ${attributes}><div class="m-fixture-teaser-card__team-name">Botafogo</div><div class="m-fixture-teaser-card__team-name">Cienciano</div></article>`;
    const page = `<div ${attributes} data-display-mode="match_centre_hero" data-tbc="0"></div><li class="m-match-fixture-details__list-item--referee"><span class="m-match-fixture-details__list-item-value">Juan Gabriel Benítez Mareco</span></li>`;
    const client = new ConmebolClient(
      vi
        .fn<typeof fetch>()
        .mockImplementation((url) =>
          Promise.resolve(new Response(requestUrl(url).endsWith('/team/4') ? listing : page)),
        ),
    );
    const match = {
      ...fixture,
      competition: 'Sul-Americana',
      date: '2026-08-20',
      time: '21:30',
      away: 'Cienciano',
    };
    expect(await client.getSheet(match)).toMatchObject({
      source: 'CONMEBOL',
      referee: 'Juan Gabriel Benítez Mareco',
      kickoffAt: new Date('2026-08-21T00:30:00Z'),
      starters: [],
      opponentStarters: [],
    });
    expect(await client.getSheet({ ...match, date: '2026-08-21' })).toBeNull();
  });
});
