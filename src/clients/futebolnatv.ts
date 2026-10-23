import { z } from 'zod';

import { createCache, fetchText } from './http.js';
import { kindFromSectionTitle, normalizeBroadcasts } from '../football/channels.js';
import type { Broadcast, BroadcastKind } from '../football/types.js';

const BASE_URL = 'https://www.futebolnatv.com.br';
const BOTAFOGO_TEAM_PATH = '/time/botafogo-ismcs361ob';
const CACHE_MILLISECONDS = 30 * 60_000;
const MAX_MATCH_PAGES = 3;

const sportsEventSchema = z.object({
  '@type': z.literal('SportsEvent'),
  name: z.string(),
  startDate: z.string(),
  homeTeam: z.object({ name: z.string() }),
  awayTeam: z.object({ name: z.string() }),
  organizer: z.object({ name: z.string() }).optional(),
});

const faqSchema = z.object({
  '@type': z.literal('FAQPage'),
  mainEntity: z.array(
    z.object({ name: z.string(), acceptedAnswer: z.object({ text: z.string() }) }),
  ),
});

export interface BroadcastListing {
  url: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  competition: string | null;
  broadcasts: Broadcast[];
}

export interface FutebolNaTvClientOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Lê a página pública do Botafogo no futebolnatv.com.br, que informa canais de TV aberta,
 * assinatura e streaming de todas as emissoras. Não há API oficial; o parser valida os dados
 * estruturados (JSON-LD) e falha explicitamente se a página mudar.
 */
export class FutebolNaTvClient {
  private readonly listings;

  constructor(private readonly options: FutebolNaTvClientOptions = {}) {
    this.listings = createCache(CACHE_MILLISECONDS, () => this.loadBotafogoListings());
  }

  async getBotafogoListings(): Promise<BroadcastListing[]> {
    return this.listings.get();
  }

  clearCache(): void {
    this.listings.clear();
  }

  private async loadBotafogoListings(): Promise<BroadcastListing[]> {
    const teamHtml = await this.fetchPage(BOTAFOGO_TEAM_PATH);
    const paths = extractMatchPaths(teamHtml).slice(0, MAX_MATCH_PAGES);
    if (paths.length === 0) throw new Error('Nenhum jogo encontrado no futebolnatv');
    const pages = await Promise.all(paths.map((path) => this.fetchPage(path)));
    return pages.map((html, index) =>
      parseFutebolNaTvMatchHtml(html, `${BASE_URL}${paths[index]}`),
    );
  }

  private async fetchPage(path: string): Promise<string> {
    return fetchText(`${BASE_URL}${path}`, {
      context: 'futebolnatv',
      attempts: 2,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
  }
}

export function extractMatchPaths(html: string): string[] {
  const paths = [...html.matchAll(/href="(\/aovivo\/[a-z0-9-]+\.html)"/g)].map((match) => match[1]);
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export function parseFutebolNaTvMatchHtml(html: string, url: string): BroadcastListing {
  const structured = extractJsonLd(html);
  const event = structured.map((item) => sportsEventSchema.safeParse(item)).find((r) => r.success);
  if (!event?.success) throw new Error('Dados do jogo não encontrados no futebolnatv');

  const kickoff = new Date(event.data.startDate);
  if (Number.isNaN(kickoff.getTime())) throw new Error('Horário inválido no futebolnatv');

  let broadcasts = extractChannelSections(html);
  if (broadcasts.length === 0) broadcasts = extractChannelsFromFaq(structured);

  return {
    url,
    homeTeam: event.data.homeTeam.name,
    awayTeam: event.data.awayTeam.name,
    kickoffAt: kickoff.toISOString(),
    competition: event.data.organizer?.name ?? null,
    broadcasts,
  };
}

function extractJsonLd(html: string): unknown[] {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].flatMap(
    ([, body]) => {
      try {
        return [JSON.parse(body ?? '') as unknown];
      } catch {
        return [];
      }
    },
  );
}

function extractChannelSections(html: string): Broadcast[] {
  const panelStart = html.indexOf('id="tabpanel-onde-assistir"');
  if (panelStart < 0) return [];
  const contentStart = html.indexOf('>', panelStart) + 1;
  const panelEnd = html.indexOf('role="tabpanel"', contentStart);
  const panel = html.slice(contentStart, panelEnd > contentStart ? panelEnd : undefined);

  const items: Array<{ name: string; kind: BroadcastKind | null }> = [];
  for (const section of panel.split('<section').slice(1)) {
    const title = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(section)?.[1];
    const kind = title ? kindFromSectionTitle(stripTags(title)) : null;
    for (const channel of section.matchAll(
      /<a href="\/canal\/[^"]+"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g,
    )) {
      const name = stripTags(channel[1] ?? '');
      if (name) items.push({ name, kind });
    }
  }
  return normalizeBroadcasts(items);
}

function extractChannelsFromFaq(structured: unknown[]): Broadcast[] {
  const faq = structured.map((item) => faqSchema.safeParse(item)).find((result) => result.success);
  if (!faq?.success) return [];
  const answer = faq.data.mainEntity.find((item) => /canal/i.test(item.name))?.acceptedAnswer.text;
  const list = answer ? /\bpor\s+(.+?)\.?$/i.exec(answer.trim())?.[1] : undefined;
  if (!list) return [];
  return normalizeBroadcasts(list.split(/,\s*|\s+e\s+/).map((name) => ({ name })));
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
