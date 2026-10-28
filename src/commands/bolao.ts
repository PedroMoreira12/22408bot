import {
  EXACT_SCORE_POINTS,
  OUTCOME_POINTS,
  type MatchPrediction,
  type PredictionRankingEntry,
} from '../football/predictions.js';
import type { FootballMatch, MatchReport } from '../football/types.js';
import { formatShortDateKey } from '../lib/time.js';
import {
  formatGoals,
  formatNaturalList,
  formatOutcome,
  formatScoreLine,
  formatWhen,
  MAX_MESSAGE_LENGTH,
} from './sports.js';

const MAX_NAMES_PER_SCORE = 30;
/** Espaço reservado para a linha de "e mais N palpites" quando a lista é cortada. */
const OMITTED_LINE_RESERVE = 60;
const MEDALS = ['🥇', '🥈', '🥉'];

interface ScoreGroup {
  home: number;
  away: number;
  names: string[];
  points: number;
}

export interface BolaoResultTopic {
  title: string;
  text: string;
}

/** Lista os palpites do jogo agrupados por placar, para o comando `!palpites`. */
export function formatPredictionList(
  match: FootballMatch,
  predictions: MatchPrediction[],
  names: Map<number, string>,
  now = new Date(),
): string {
  const valid = predictions.filter((prediction) => prediction.status !== 'void');
  const open = match.status === 'scheduled' && new Date(match.kickoffAt) > now;
  const header = [`🎯 Palpites para ${match.homeTeam.name} x ${match.awayTeam.name}`];
  if (match.status === 'live') {
    header.push(
      `🔴 Em andamento: ${formatScoreLine(match)}${match.liveDetail ? ` (${match.liveDetail})` : ''} — palpites encerrados`,
    );
  } else {
    header.push(
      open ? `⏳ Palpites abertos até ${formatWhen(match, now, false)}` : '🔒 Palpites encerrados',
    );
  }

  if (valid.length === 0) {
    return [
      ...header,
      open
        ? 'Ninguém deu palpite ainda. Seja o primeiro: !palpite 2x1 (gols do mandante primeiro).'
        : 'Ninguém deu palpite para este jogo.',
    ].join('\n');
  }

  let homeWins = 0;
  let draws = 0;
  for (const prediction of valid) {
    if (prediction.homeGoals > prediction.awayGoals) homeWins += 1;
    else if (prediction.homeGoals === prediction.awayGoals) draws += 1;
  }
  const awayWins = valid.length - homeWins - draws;
  header.push(
    `📊 ${valid.length} palpite(s): ${match.homeTeam.name} vence ${homeWins} · empate ${draws} · ${match.awayTeam.name} vence ${awayWins}`,
    '',
  );
  const footer = open ? ['', '💡 Mande ou mude o seu com !palpite 2x1 antes do jogo.'] : [];
  const groups = fitGroups(
    groupByScore(valid, names),
    (group) =>
      `• ${group.home} x ${group.away} (${group.names.length}): ${formatNames(group.names)}`,
    MAX_MESSAGE_LENGTH - [...header, ...footer].join('\n').length,
  );
  return [...header, ...groups, ...footer].join('\n');
}

/** Título e texto do tópico com o resultado do bolão de um jogo conferido. */
export function formatBolaoResultTopic(
  report: MatchReport,
  predictions: MatchPrediction[],
  leaders: PredictionRankingEntry[],
  names: Map<number, string>,
  season: number,
): BolaoResultTopic {
  const { match } = report;
  const settled = predictions.filter((prediction) => prediction.status === 'settled');
  const voided = predictions.filter((prediction) => prediction.status === 'void').length;
  const nameOf = (userId: string) => names.get(Number(userId)) ?? 'Membro';
  const exactNames = settled
    .filter((prediction) => prediction.exact)
    .map((prediction) => nameOf(prediction.userId))
    .sort(compareNames);
  const outcomeCount = settled.filter(
    (prediction) => !prediction.exact && prediction.points,
  ).length;
  const missedCount = settled.length - exactNames.length - outcomeCount;

  const header = [
    `🏁 ${formatScoreLine(match)}${formatOutcome(match)}`,
    `🏆 ${match.competition} · ${formatShortDateKey(match.date)}`,
    ...formatGoals(report.goals),
    '',
    `🎯 Bolão conferido: ${settled.length} palpite(s)`,
    exactNames.length > 0
      ? `✅ Cravaram o placar (+${EXACT_SCORE_POINTS}): ${formatNames(exactNames)}`
      : '✅ Ninguém cravou o placar desta vez.',
    `👍 Acertaram o resultado (+${OUTCOME_POINTS}): ${outcomeCount}`,
    `❌ Erraram: ${missedCount}`,
    ...(voided > 0 ? [`⛔ Anulados (enviados depois do início): ${voided}`] : []),
    '',
    '📋 Todos os palpites',
  ];
  const footer = [
    '',
    `🏆 Ranking do bolão ${season}`,
    ...leaders.map((entry, index) => formatRankingLine(entry, index, names)),
    '',
    '📌 Ranking completo: !bolao · Palpites do próximo jogo: !palpites',
  ];
  const groups = fitGroups(
    groupByScore(settled, names),
    (group) => {
      const marker = group.points >= EXACT_SCORE_POINTS ? '✅' : group.points > 0 ? '👍' : '❌';
      const points = group.points > 0 ? ` — +${group.points}` : '';
      return `${marker} ${group.home} x ${group.away} (${group.names.length}): ${formatNames(group.names)}${points}`;
    },
    MAX_MESSAGE_LENGTH - [...header, ...footer].join('\n').length,
  );
  return {
    // "[ON]" é o prefixo padrão da comunidade para tópicos de jogo.
    title: `[ON] Bolão: ${formatScoreLine(match)} (${formatShortDateKey(match.date)})`,
    text: [...header, ...groups, ...footer].join('\n'),
  };
}

export function formatRankingLine(
  entry: PredictionRankingEntry,
  index: number,
  names: Map<number, string>,
): string {
  return `${MEDALS[index] ?? `${index + 1}.`} ${names.get(Number(entry.userId)) ?? 'Membro'} — ${entry.points} pts (${entry.exact} exato(s) em ${entry.predictions} palpite(s))`;
}

/** Placares com mais pontos primeiro; depois os mais escolhidos. */
function groupByScore(predictions: MatchPrediction[], names: Map<number, string>): ScoreGroup[] {
  const groups = new Map<string, ScoreGroup>();
  for (const prediction of predictions) {
    const key = `${prediction.homeGoals}x${prediction.awayGoals}`;
    const group = groups.get(key) ?? {
      home: prediction.homeGoals,
      away: prediction.awayGoals,
      names: [],
      points: prediction.points ?? 0,
    };
    group.names.push(names.get(Number(prediction.userId)) ?? 'Membro');
    groups.set(key, group);
  }
  for (const group of groups.values()) group.names.sort(compareNames);
  return [...groups.values()].sort(
    (left, right) =>
      right.points - left.points ||
      right.names.length - left.names.length ||
      right.home - left.home ||
      left.away - right.away,
  );
}

/** Mantém as linhas dentro do limite da VK e resume o que ficou de fora. */
function fitGroups(
  groups: ScoreGroup[],
  format: (group: ScoreGroup) => string,
  budget: number,
): string[] {
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const group of groups) {
    const line = format(group);
    if (omitted === 0 && used + line.length + 1 <= budget - OMITTED_LINE_RESERVE) {
      lines.push(line);
      used += line.length + 1;
    } else {
      omitted += group.names.length;
    }
  }
  if (omitted > 0) lines.push(`...e mais ${omitted} palpite(s) em outros placares.`);
  return lines;
}

function formatNames(names: string[]): string {
  if (names.length <= MAX_NAMES_PER_SCORE) return formatNaturalList(names);
  return `${names.slice(0, MAX_NAMES_PER_SCORE).join(', ')} e mais ${names.length - MAX_NAMES_PER_SCORE}`;
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, 'pt-BR');
}
