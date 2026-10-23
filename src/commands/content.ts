// A VK não interpreta Markdown em comentários de tópicos; use apenas texto simples e emojis.
export const tutorialMessage = `🔥 Comandos do Pimpão Bot 🤖
Todos começam com ! no início do comentário.

⚽ JOGOS
!jogo — próximo jogo do Botafogo, com canais e contagem regressiva
!agenda — jogos de hoje da Série A, Copa do Brasil, Libertadores, Sul-Americana e Carioca
!agenda amanhã | sábado | 25/10 | semana | botafogo — outras datas ou só o Botafogo
!resultado — último jogo do Botafogo, com os gols
!escalacao — escalação do próximo jogo (ou a última, se ainda não saiu)
!tabela — Botafogo e vizinhos na Série A
!rodada — jogos da rodada atual da Série A
!avisar — marco você 30 min antes do próximo jogo (!avisar cancelar para desistir)

🎯 BOLÃO
!palpite 2x1 — palpite para o próximo jogo, com os gols do mandante primeiro
!palpite — mostra o seu palpite
!bolao [ano] — ranking: placar exato vale 3 pontos; vencedor ou empate vale 1

📊 COMUNIDADE
!stats [ano] — suas estatísticas de atividade
!top [N] [ano] — ranking dos mais ativos (ex.: !top5 ou !top 5 2026)
!sequencia [ano] — sua maior sequência de dias ativos
!retrospectiva [ano] — resumo da comunidade no ano
!recordes [ano] — recordes de atividade do ano
!camisa7 — sócios do plano Camisa 7 e a variação da semana

⏰ LEMBRETES
!r 10 minutos (ou horas, dias, meses) — marco você depois do tempo pedido
!lembretes — seus lembretes e avisos de jogo pendentes

✈️ OUTROS
!c [mensagem] — cita você com uma mensagem
!gsd — agradece o ritual do mago Duds pela magia da GSD
!antizica — afasta qualquer tentativa de zica
!mongol — resposta anti-GSD
!upem — link do tópico das coisas que você só conhece pela comunidade
!m — envia o link do tópico por mensagem privada (siga a página do bot e mande uma mensagem para ela antes)

ℹ️ Comandos de consulta têm intervalo de 1 minuto por pessoa.`;

export const gsdMessages = ['Gracias Señor Duds!'] as const;
export const antiZicaMessages = ['🤖 ¡AntiZica ativado!'] as const;
export const antiGsdMessages = ['MONGOLOIDE'] as const;

export function randomItem<T>(items: readonly T[], random = Math.random): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('Lista de mensagens vazia');
  return item;
}
