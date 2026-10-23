/** Respostas reduzidas da ESPN, no mesmo formato observado na API pública. */

export const competitor = (
  homeAway: 'home' | 'away',
  id: string,
  displayName: string,
  score?: unknown,
) => ({ homeAway, team: { id, displayName }, ...(score === undefined ? {} : { score }) });

export const status = (
  state: 'pre' | 'in' | 'post',
  name = state === 'pre'
    ? 'STATUS_SCHEDULED'
    : state === 'in'
      ? 'STATUS_FIRST_HALF'
      : 'STATUS_FULL_TIME',
  shortDetail = state === 'in' ? "35'" : 'F',
) => ({ type: { name, state, completed: state === 'post', shortDetail } });

export const espnEvent = (options: {
  id: string;
  date: string;
  home: [string, string];
  away: [string, string];
  league?: { slug: string; name: string };
  state?: 'pre' | 'in' | 'post';
  score?: [unknown, unknown];
  timeValid?: boolean;
  venue?: string;
  seasonType?: string;
  notes?: Array<{ type: string; headline: string }>;
}) => ({
  id: options.id,
  date: options.date,
  timeValid: options.timeValid ?? true,
  ...(options.league ? { league: options.league } : {}),
  ...(options.seasonType ? { seasonType: { name: options.seasonType } } : {}),
  competitions: [
    {
      id: options.id,
      date: options.date,
      timeValid: options.timeValid ?? true,
      venue: options.venue ? { fullName: options.venue } : undefined,
      competitors: [
        competitor('home', ...options.home, options.score?.[0]),
        competitor('away', ...options.away, options.score?.[1]),
      ],
      status: status(options.state ?? 'pre'),
      notes: options.notes ?? [],
    },
  ],
});

export const summaryPayload = {
  header: {
    id: '401841268',
    league: { slug: 'bra.1', name: 'Campeonato Brasileiro' },
    competitions: [
      {
        id: '401841268',
        date: '2026-10-17T21:00Z',
        competitors: [
          competitor('home', '6086', 'Botafogo', '2'),
          competitor('away', '9318', 'Chapecoense', '1'),
        ],
        status: status('post'),
      },
    ],
  },
  gameInfo: { venue: { fullName: 'Joao Havelange Stadium' } },
  keyEvents: [
    { id: '1', type: { type: 'kickoff' }, scoringPlay: false },
    {
      id: '53830225',
      type: { type: 'goal---header', text: 'Gol de cabeça' },
      scoringPlay: true,
      clock: { displayValue: "7'" },
      team: { id: '6086', displayName: 'Botafogo' },
      participants: [{ athlete: { displayName: 'Tiquinho Soares' } }],
    },
    {
      id: '53830300',
      type: { type: 'penalty---scored', text: 'Pênalti convertido' },
      scoringPlay: true,
      clock: { displayValue: "40'" },
      team: { id: '9318', displayName: 'Chapecoense' },
      participants: [{ athlete: { displayName: 'Perotti' } }],
    },
    {
      id: '53830400',
      type: { type: 'goal', text: 'Gol' },
      scoringPlay: true,
      clock: { displayValue: "88'" },
      team: { id: '6086', displayName: 'Botafogo' },
      participants: [{ athlete: { displayName: 'Matheus Martins' } }],
    },
  ],
  rosters: [
    {
      team: { id: '6086', displayName: 'Botafogo' },
      formation: '4-2-3-1',
      roster: [
        ...Array.from({ length: 11 }, (_, index) => ({
          starter: true,
          athlete: { displayName: `Titular ${index + 1}` },
        })),
        { starter: false, athlete: { displayName: 'Reserva' } },
      ],
    },
    {
      team: { id: '9318', displayName: 'Chapecoense' },
      formation: '4-4-2',
      roster: [{ starter: true, athlete: { displayName: 'Único' } }],
    },
  ],
};
