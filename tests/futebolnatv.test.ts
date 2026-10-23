import { describe, expect, it, vi } from 'vitest';

import {
  extractMatchPaths,
  FutebolNaTvClient,
  parseFutebolNaTvMatchHtml,
} from '../src/clients/futebolnatv.js';

const channel = (slug: string, name: string) => `
  <li><a href="/canal/${slug}" class="block"><div><img src="x.png" alt=""></div>
    <div class="min-w-0 flex-1"><p class="text-sm font-semibold">
      ${name}
    </p><p class="mt-0.5"></p></div></a></li>`;

const section = (title: string, channels: string[]) => `
  <section class="space-y-2"><h3 class="text-xs">
    ${title}
  </h3><ul>${channels.join('')}</ul></section>`;

const matchPage = (options: { sections?: string; faqAnswer?: string } = {}) => `
<html><head>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SportsEvent',
  name: 'Vasco x Corinthians',
  startDate: '2026-10-24T18:30:00-03:00',
  homeTeam: { '@type': 'SportsTeam', name: 'Vasco' },
  awayTeam: { '@type': 'SportsTeam', name: 'Corinthians' },
  organizer: { '@type': 'SportsOrganization', name: 'Brasileirão Série A' },
})}</script>
<script type="application/ld+json">${JSON.stringify({
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Qual canal vai transmitir Vasco x Corinthians?',
      acceptedAnswer: { text: options.faqAnswer ?? 'O jogo será transmitido por RECORD e CAZÉTV.' },
    },
  ],
})}</script>
</head><body>
<a href="/canal/globo">GLOBO</a>
<div id="tabpanel-onde-assistir" role="tabpanel" aria-labelledby="tab-onde-assistir" hidden>
  ${options.sections ?? ''}
</div>
<section id="jogo-sobre-partida" role="tabpanel">${section('Outros', [channel('sbt', 'SBT')])}</section>
</body></html>`;

describe('futebolnatv', () => {
  it('lê canais por categoria apenas no painel "onde assistir"', () => {
    const html = matchPage({
      sections: [
        section('Canal com sinal aberto', [channel('record', 'RECORD')]),
        section('Canal por assinatura', [channel('premiere-2', 'PREMIERE 2')]),
        section('Streeming aberto', [channel('cazetv', 'CAZÉTV')]),
        section('Streeming por assinatura', [channel('prime-video', 'PRIME VIDEO')]),
      ].join(''),
    });

    expect(parseFutebolNaTvMatchHtml(html, 'https://x/jogo.html')).toEqual({
      url: 'https://x/jogo.html',
      homeTeam: 'Vasco',
      awayTeam: 'Corinthians',
      kickoffAt: '2026-10-24T21:30:00.000Z',
      competition: 'Brasileirão Série A',
      broadcasts: [
        { name: 'Record', kind: 'open-tv' },
        { name: 'Premiere 2', kind: 'pay-tv' },
        { name: 'CazéTV', kind: 'free-streaming' },
        { name: 'Prime Video', kind: 'paid-streaming' },
      ],
    });
  });

  it('usa o FAQ estruturado quando o painel não tem canais', () => {
    const listing = parseFutebolNaTvMatchHtml(
      matchPage({ faqAnswer: 'A partida terá transmissão ao vivo por GLOBO, PREMIERE 3 e GE TV.' }),
      'u',
    );
    expect(listing.broadcasts.map((item) => item.name)).toEqual(['Globo', 'Premiere 3', 'ge tv']);
  });

  it('falha quando a página não tem os dados estruturados do jogo', () => {
    expect(() => parseFutebolNaTvMatchHtml('<html></html>', 'u')).toThrow(
      'Dados do jogo não encontrados',
    );
  });

  it('segue os links de jogos da página do clube', async () => {
    const teamPage = `<a href="/aovivo/botafogo-x-chapecoense-sc-1.html">a</a>
      <a href="/aovivo/internacional-x-botafogo-2.html">b</a>
      <a href="/aovivo/botafogo-x-chapecoense-sc-1.html">c</a>`;
    expect(extractMatchPaths(teamPage)).toEqual([
      '/aovivo/botafogo-x-chapecoense-sc-1.html',
      '/aovivo/internacional-x-botafogo-2.html',
    ]);

    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = input instanceof Request ? input.url : input.toString();
      return Promise.resolve(new Response(url.includes('/time/') ? teamPage : matchPage()));
    });
    const listings = await new FutebolNaTvClient({ fetchImpl }).getBotafogoListings();
    expect(listings).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
