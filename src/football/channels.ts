import type { Broadcast, BroadcastKind } from './types.js';

/** Itens que as fontes listam junto dos canais, mas que não transmitem o jogo. */
const IGNORED_SOURCES = new Set(['cartola', 'cartola pro']);

const DISPLAY_NAMES: Record<string, string> = {
  globo: 'Globo',
  'tv globo': 'Globo',
  'rede globo': 'Globo',
  globoplay: 'Globoplay',
  sportv: 'sportv',
  premiere: 'Premiere',
  'premiere fc': 'Premiere FC',
  'ge tv': 'ge tv',
  record: 'Record',
  'record tv': 'Record',
  band: 'Band',
  bandsports: 'BandSports',
  sbt: 'SBT',
  'tv brasil': 'TV Brasil',
  'tv cultura': 'TV Cultura',
  redetv: 'RedeTV!',
  'redetv!': 'RedeTV!',
  cazetv: 'CazéTV',
  'cazé tv': 'CazéTV',
  cazétv: 'CazéTV',
  youtube: 'YouTube',
  'prime video': 'Prime Video',
  'prime vídeo': 'Prime Video',
  'amazon prime video': 'Prime Video',
  'disney+': 'Disney+',
  espn: 'ESPN',
  'paramount+': 'Paramount+',
  'hbo max': 'HBO Max',
  max: 'Max',
  tnt: 'TNT',
  'tnt sports': 'TNT Sports',
  sportynet: 'SportyNet',
  xsports: 'XSports',
  onefootball: 'OneFootball',
  'canal goat': 'Canal GOAT',
  dazn: 'DAZN',
  'nosso futebol': 'Nosso Futebol',
  'conmebol tv': 'Conmebol TV',
};

const OPEN_TV = new Set(['globo', 'record', 'band', 'sbt', 'tv brasil', 'tv cultura', 'redetv!']);
const FREE_STREAMING = new Set(['ge tv', 'cazétv', 'youtube', 'canal goat', 'sportynet']);
const PAID_STREAMING = new Set([
  'globoplay',
  'prime video',
  'disney+',
  'paramount+',
  'hbo max',
  'max',
  'dazn',
  'onefootball',
  'nosso futebol',
]);
const PAY_TV_PREFIXES = ['sportv', 'premiere', 'espn', 'tnt', 'bandsports', 'xsports', 'conmebol'];

export const BROADCAST_KIND_LABELS: Record<BroadcastKind, string> = {
  'open-tv': 'TV aberta',
  'pay-tv': 'TV por assinatura',
  'free-streaming': 'Streaming gratuito',
  'paid-streaming': 'Streaming por assinatura',
  other: 'Também em',
};

const KIND_ORDER: BroadcastKind[] = [
  'open-tv',
  'pay-tv',
  'free-streaming',
  'paid-streaming',
  'other',
];

export function displayChannelName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  const parenthetical = /^(.*?)\s*\((.+)\)$/.exec(name);
  if (parenthetical?.[1] && parenthetical[2]) {
    return `${displayChannelName(parenthetical[1])} (${displayChannelName(parenthetical[2])})`;
  }

  const key = name.toLocaleLowerCase('pt-BR');
  const known = DISPLAY_NAMES[key];
  if (known) return known;
  const numbered = /^(.+?)\s+(\d+)$/.exec(key);
  if (numbered?.[1] && numbered[2] && DISPLAY_NAMES[numbered[1]]) {
    return `${DISPLAY_NAMES[numbered[1]]} ${numbered[2]}`;
  }
  return name;
}

export function classifyChannel(name: string): BroadcastKind {
  const key = displayChannelName(name)
    .toLocaleLowerCase('pt-BR')
    .replace(/\s*\(.*\)$/, '');
  if (OPEN_TV.has(key)) return 'open-tv';
  if (FREE_STREAMING.has(key)) return 'free-streaming';
  if (PAID_STREAMING.has(key)) return 'paid-streaming';
  if (PAY_TV_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'pay-tv';
  return 'other';
}

export function kindFromSectionTitle(title: string): BroadcastKind | null {
  const normalized = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const paid = normalized.includes('assinatura') || normalized.includes('pago');
  if (normalized.includes('stream')) return paid ? 'paid-streaming' : 'free-streaming';
  if (normalized.includes('canal') || normalized.includes('tv')) return paid ? 'pay-tv' : 'open-tv';
  return null;
}

/** Remove itens que não são transmissões, padroniza nomes e elimina duplicatas. */
export function normalizeBroadcasts(
  items: Array<{ name: string; kind?: BroadcastKind | null }>,
): Broadcast[] {
  const seen = new Map<string, Broadcast>();
  for (const item of items) {
    const name = displayChannelName(item.name);
    const key = name.toLocaleLowerCase('pt-BR');
    if (!name || IGNORED_SOURCES.has(key) || seen.has(key)) continue;
    seen.set(key, { name, kind: item.kind ?? classifyChannel(name) });
  }
  return [...seen.values()];
}

export function groupBroadcasts(broadcasts: Broadcast[]): Array<[BroadcastKind, string[]]> {
  return KIND_ORDER.flatMap((kind) => {
    const names = broadcasts.filter((item) => item.kind === kind).map((item) => item.name);
    return names.length > 0 ? [[kind, names] as [BroadcastKind, string[]]] : [];
  });
}
