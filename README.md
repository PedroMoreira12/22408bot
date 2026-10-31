# Pimpão Bot VK

Bot serverless para comandos nos tópicos de discussão do VK. O cron-job.org aciona uma função curta na Vercel; MongoDB mantém cursores, fila de comandos, lembretes, bolão e estatísticas.

O polling recupera no máximo as últimas 24 horas de atividade. Após uma interrupção mais longa, comentários anteriores a essa janela são ignorados e os cursores avançam sem executar comandos antigos.

## Comandos

A lista completa, no formato publicado para os usuários, fica em `src/commands/content.ts` (`!tutorial`, `!ajuda` ou `!comandos`).

**Jogos**

- `!jogo`, `!proximo`: próximo jogo do Botafogo em qualquer competição, com contagem regressiva, estádio e canais separados em TV aberta, TV por assinatura e streaming.
- `!agenda` (hoje), `!agenda amanhã`, `!agenda sábado`, `!agenda 25/10`, `!agenda semana`: jogos da Série A, Copa do Brasil, Libertadores, Sul-Americana e Carioca.
- `!agenda botafogo`: todos os próximos jogos do Botafogo já marcados.
- `!resultado`, `!ultimo`: último jogo do Botafogo com os autores dos gols.
- `!escalacao`: escalação do próximo jogo (divulgada cerca de 1h antes) ou a última escalação.
- `!tabela` e `!rodada`: Botafogo e vizinhos na Série A; jogos da rodada atual.
- `!avisar` / `!avisar cancelar`: marca o autor 30 minutos antes do próximo jogo, acompanhando mudanças de horário.

**Bolão**

- `!palpite 2x1`: palpite para o próximo jogo, com os gols do mandante primeiro. Pode ser alterado até o início da partida.
- `!palpite`: mostra o palpite atual do autor.
- `!palpites`: todos os palpites do próximo jogo (ou do jogo em andamento), agrupados por placar.
- `!bolao [ano]`: ranking anual. Placar exato vale 3 pontos; acertar vencedor ou empate vale 1. Palpites enviados depois do início real do jogo são anulados.

Quando um jogo com palpites válidos é conferido, o bot cria um tópico `[ON] Bolão: <placar> (<dd/mm>)` com o resultado, os gols, quem cravou, todos os palpites com a pontuação e o top 5 do ano. Jogos sem palpites não geram tópico. Esse tópico não depende de `MATCH_TOPIC_ID`.

24 horas antes do próximo jogo (com horário confirmado), o bot também cria o tópico `[ON] Palpites: <jogo> (<dd/mm>)` para concentrar os palpites: informações da partida e canais, como em `!jogo`, a chamada para `!palpite` e o ranking do bolão dividido por ano — top 10 do ano atual e o pódio final de cada ano anterior. Também não depende de `MATCH_TOPIC_ID`.

**Comunidade e utilidades**

- `!stats`, `!top`, `!sequencia`, `!retrospectiva`, `!recordes`: estatísticas de atividade desde 2026.
- `!camisa7`: sócios do plano Camisa 7 e variação em relação a sete dias antes.
- `!r 10 minutos`, `!lembretes`, `!c`, `!gsd`, `!antizica`, `!mongol`, `!upem`, `!m`.

Comandos de consulta têm cooldown por autor (1 minuto; 3 minutos para rankings da comunidade). Repetições dentro do intervalo são ignoradas sem resposta.

## Fontes de dados esportivos

Nenhuma chave esportiva é necessária.

| Uso                                       | Fonte                                                 | Observações                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Calendário, resultados, gols e escalações | API pública não oficial da ESPN (`site.api.espn.com`) | JSON em português; informa quando o horário ainda não foi confirmado.                                               |
| Canais de transmissão                     | Página pública do Botafogo no futebolnatv.com.br      | Inclui Globo, Record, CazéTV, ESPN, Prime Video e outros, separados por tipo.                                       |
| Reserva                                   | Páginas de agenda do ge                               | Usadas quando a ESPN falha ou quando o futebolnatv não informa os canais. A página do clube traz só o próximo jogo. |
| Tabela e rodada                           | `campeonato-brasileiro-api`                           | Somente Série A.                                                                                                    |

As respostas são validadas com Zod e mantidas em cache (5 a 30 minutos). ESPN, futebolnatv e ge não oferecem contrato de API: os testes cobrem os parsers e as falhas são explícitas. Se uma fonte cair, o comando responde na hora que os dados estão indisponíveis, em vez de repetir por horas. O futebolnatv proíbe a reprodução do conteúdo; o bot faz poucas requisições (cache de 30 minutos) e cita a fonte nas respostas.

## Feed automático do jogo (opcional)

Com `MATCH_TOPIC_ID` configurado, o bot publica nesse tópico:

- chamada do dia de jogo, 2 horas antes, com canais e convite para `!palpite` e `!avisar`;
- escalações, quando divulgadas;
- cada gol, uma única vez;
- placar final e o resumo do bolão conferido.

Cada publicação usa `guid` determinístico, então execuções repetidas não duplicam comentários. Sem a variável, o feed fica desligado.

## Coleta de estatísticas

Comentários comuns e tópicos criados por usuários são armazenados como eventos idempotentes, separados por ano e dia no horário de São Paulo. O texto dos comentários, nomes e fotos não são armazenados. O backfill gradual desde 01/01/2026 roda ao fim de cada execução; acompanhe `activityBackfill.status` na resposta de `POST /api/jobs/run`. Detalhes em `AGENTS.md`.

A fila de comandos guarda o texto do comentário enquanto o comando é processado; jobs concluídos ou falhos expiram após 30 dias.

## Configuração

1. Use Node.js 24 (há um `.nvmrc`) e execute `npm install`.
2. Copie `.env.example` para `.env` e preencha os valores localmente.
3. Gere `CRON_SECRET` com pelo menos 16 caracteres e cadastre o mesmo valor nas variáveis da Vercel.
4. Opcional: defina `MATCH_TOPIC_ID` com o ID numérico do tópico do feed de jogos.
5. Execute `npm run check` antes do deploy.

## Vercel e cron-job.org

Depois do deploy, confirme que `GET /api/health` retorna `status: ok`. Antes de ativar o cron, faça uma única chamada autenticada a `POST /api/jobs/run`; ela inicializa os cursores sem executar comandos antigos.

No cron-job.org, configure:

- URL: `https://<seu-dominio>/api/jobs/run`
- Método: `POST`
- Intervalo: a cada minuto
- Cabeçalho: `Authorization: Bearer <CRON_SECRET>`
- Considere somente respostas HTTP `2xx` como sucesso.

Não use a rota raiz para “manter o servidor acordado”. Funções Vercel são iniciadas sob demanda e finalizam depois de cada execução.

## Desenvolvimento

```bash
npm run dev
npm run check
npm run test:coverage
```

O repositório força finais de linha LF (`.gitattributes`), para que `npm run check` também passe no Windows.

Documentação da API VK: <https://dev.vk.com/en/reference>.
