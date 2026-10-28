# Bot VK — contexto do projeto

## Objetivo

O **Pimpão Bot** responde a comandos publicados nos tópicos de discussão de uma comunidade de torcedores do Botafogo no VK. O projeto usa TypeScript estrito, Node.js 24 e funções serverless da Vercel.

Referência oficial da VK: <https://dev.vk.com/en/reference>. A base das chamadas é `https://api.vk.com/method/{method}` e a versão vem de `API_VERSION`.

## Arquitetura

- `POST /api/jobs/run` é chamado uma vez por minuto pelo cron-job.org com `Authorization: Bearer <CRON_SECRET>`.
- Cada invocação adquire um lease global no MongoDB e executa, nesta ordem: polling dos tópicos, comandos pendentes, lembretes, avisos de jogo (`!avisar`), feed do jogo (se `MATCH_TOPIC_ID` estiver definido), conferência do bolão, tópico de resultado do bolão, contagem diária do Camisa 7 e backfill de atividade.
- Polling, comandos e lembretes são obrigatórios. As demais etapas são opcionais: só começam se restarem pelo menos 8 segundos do orçamento de 45 segundos, e uma falha nelas é registrada sem interromper o job.
- `GET /api/health` é um health check sem dependência de banco ou configuração.
- Cursores por tópico, jobs únicos por comentário e IDs determinísticos nas escritas VK evitam perda e duplicação.
- A primeira execução inicializa os cursores sem responder a comentários históricos.
- O polling limita a recuperação às últimas 24 horas; comentários mais antigos são ignorados após indisponibilidades prolongadas.
- Cada comentário novo, contenha comando ou não, gera um evento de atividade idempotente antes de o cursor avançar. Tópicos criados por usuários também geram eventos.

Não adicione processos contínuos, `setInterval` ou listeners de Long Poll: a Vercel executa funções sob demanda. O usuário não administra a comunidade monitorada e, portanto, não pode cadastrar Callback API nela.

## API VK

Métodos usados:

- `board.getTopics` e `board.getComments` para polling.
- `board.createComment` para respostas e para o feed do jogo, sempre com `guid` determinístico. No feed, `reply_to_comment` é omitido.
- `board.addTopic` para o tópico de resultado do bolão (token de usuário; `group_id`, `title`, `text`; responde o ID do tópico). O método não aceita `guid`: a chamada não é repetida pelo cliente, e o job procura entre os 50 tópicos mais recentes (`order=2`; os fixados vêm sempre primeiro) um com o mesmo título antes de criar outro. Erros esperados: 14 (captcha), 15 (sem permissão) e 703 (a comunidade exige 2FA na conta). `groups.getById?fields=can_create_topic` mostra, sem criar nada, se a conta do token pode criar tópicos.
- `users.get` quando `board.getComments?extended=1` não fornece o perfil e, em lote (`getUserFirstNames`), para rankings, bolão e avisos de jogo. Nunca faça uma chamada por usuário em laço.
- `groups.isMember` para excluir ex-membros dos rankings.
- `messages.send` com token da comunidade e `random_id` determinístico e não zero.

Para estatísticas, `board.getComments` fornece `from_id` e `date`, enquanto `board.getTopics` fornece `created_by` e `created`. A API não fornece a data de entrada de um membro com o token atual: `groups.getMembers?sort=time_asc` exige que o chamador seja moderador. Nunca apresente a primeira atividade observada como se fosse a data de entrada na comunidade.

Centralize chamadas em `src/clients/vk.ts`. Use POST, timeout, envelope validado, rate limiting e retry somente para falhas transitórias. Nunca registre tokens ou corpos completos de comentários.

## Comandos

| Comando                              | Comportamento                                                       |
| ------------------------------------ | ------------------------------------------------------------------- |
| `!camisa7`                           | Sócios do plano Camisa 7 e variação desde sete dias antes.          |
| `!c [mensagem]`                      | Menciona o autor com uma mensagem opcional.                         |
| `!gsd` / `!antizica` / `!mongol`     | Respostas fixas da comunidade.                                      |
| `!upem`                              | Envia o link fixo do tópico de “upar”.                              |
| `!m` / `!mensagem`                   | Envia o link do tópico por mensagem privada.                        |
| `!remind` / `!r`                     | Agenda lembrete entre 1 minuto e 365 dias.                          |
| `!lembretes`                         | Lista lembretes e avisos de jogo pendentes do autor.                |
| `!jogo`                              | Próximo jogo do Botafogo com contagem regressiva e canais por tipo. |
| `!agenda [amanhã/dia/data/semana]`   | Agenda das cinco competições acompanhadas.                          |
| `!agenda botafogo`                   | Todos os próximos jogos do Botafogo.                                |
| `!resultado` / `!ultimo`             | Último jogo do Botafogo com os gols.                                |
| `!escalacao`                         | Escalação do próximo jogo ou a última, se ainda não saiu.           |
| `!tabela` / `!rodada`                | Botafogo e vizinhos na Série A; rodada atual.                       |
| `!palpite [2x1]`                     | Registra ou mostra o palpite para o próximo jogo.                   |
| `!palpites`                          | Todos os palpites do próximo jogo, agrupados por placar.            |
| `!bolao [ano]`                       | Ranking anual do bolão.                                             |
| `!avisar` / `!avisar cancelar`       | Marca o autor 30 minutos antes do próximo jogo.                     |
| `!stats`, `!top`, `!sequencia`       | Estatísticas individuais e ranking de atividade.                    |
| `!retrospectiva`, `!recordes`        | Resumo e recordes de atividade da comunidade.                       |
| `!tutorial` / `!ajuda` / `!comandos` | Publica a lista de comandos.                                        |

Parsing fica em `src/commands/parser.ts`, execução em `src/commands/execute.ts`, formatação esportiva em `src/commands/sports.ts`, estatísticas em `src/commands/activity.ts`, cooldowns em `src/commands/cooldown.ts` e conteúdo fixo em `src/commands/content.ts`. Comandos só são reconhecidos no início do comentário.

A VK não interpreta Markdown em comentários de tópicos: escreva respostas e o tutorial em texto simples com emojis. Mantenha os arquivos em UTF-8; um teste falha se o tutorial tiver texto decodificado duas vezes (como `Ã£`).

Comandos de consulta têm cooldown por autor e chave (`agenda:tomorrow`, `top:5:2026`…): 1 minuto, ou 3 minutos para `!top`, `!retrospectiva` e `!recordes`. Repetições são concluídas com `skippedReason: 'cooldown'`, sem resposta. Comandos que gravam algo (`!palpite 2x1`, `!r`, `!avisar`) e as respostas fixas não têm cooldown.

## Fontes esportivas

`src/football/service.ts` combina as fontes e é a única porta usada por comandos e jobs:

- **ESPN** (`src/clients/espn.ts`, API pública não oficial, `lang=pt&region=br`): calendário do Botafogo em todas as competições (`/all/teams/6086/schedule`), resultados, agenda por mês e competição (`/{liga}/scoreboard?dates=AAAAMM`) e resumo da partida com gols e escalações (`/all/summary?event=ID`). `timeValid: false` significa horário ainda não confirmado: mostre “a definir” e não envie avisos com base nele.
- **futebolnatv.com.br** (`src/clients/futebolnatv.ts`): canais de transmissão do próximo jogo, lidos da página do Botafogo e das páginas de cada jogo (JSON-LD `SportsEvent` e painel “onde assistir”). Cache de 30 minutos; cite a fonte nas respostas.
- **ge** (`src/clients/ge.ts`): reserva para calendário e agenda quando a ESPN falha, e para canais quando o futebolnatv não informa. A página do clube só traz o próximo jogo. Itens como “Cartola” não são transmissões e são removidos em `src/football/channels.ts`.
- **campeonato-brasileiro-api**: exclusivo para `!tabela` e `!rodada`.

Nenhuma dessas fontes tem contrato de API: valide com Zod, mantenha testes dos parsers e falhe explicitamente se o formato mudar. Comandos esportivos não devem ficar presos em retentativas longas: `executeCommand` responde na hora que a fonte está indisponível e só repete erros da VK.

## Bolão, avisos e feed

- `Prediction`: um palpite por usuário e partida ESPN (`matchId`), editável até o início. A conferência começa 1h45 após o início, usa o placar final da ESPN, anula palpites atualizados depois do início real e acompanha remarcações; partidas adiadas por mais de 7 dias têm os palpites anulados. Pontuação: placar exato 3, vencedor ou empate 1.
- `BolaoTopic`: um tópico de resultado por partida, criado em `src/jobs/bolao-topics.ts` logo após a conferência, só para jogos com palpites conferidos nas últimas 12 horas (um deploy não anuncia jogos antigos). A tentativa é gravada antes da escrita na VK; falhas (como captcha, código 14) são repetidas com intervalo crescente, até cinco vezes.
- `GameAlert`: um aviso por usuário e partida. Cada execução atualiza o horário com a ESPN, avisa 30 minutos antes e descarta avisos com mais de 15 minutos de atraso.
- `MatchFeed`: estado do feed por partida e tópico (`MATCH_TOPIC_ID`) — chamada do dia de jogo, escalação, gols já publicados, placar final e resumo do bolão. Os `guid` determinísticos (`feed:<matchId>:<etapa>`) evitam duplicatas mesmo se o estado não for salvo.
- `Camisa7Snapshot`: uma contagem por dia em São Paulo, gravada pelo job e por `!camisa7`.

## Persistência e retentativas

- `CommandJob`: fila durável, única por tópico/comentário. Guarda o texto do comentário; jobs concluídos (`completedAt`) ou com falha definitiva (`failedAt`) expiram após 30 dias por índice TTL.
- `TopicCursor`: último comentário observado por tópico.
- `JobState`: watermark do polling, lease global e última tentativa da contagem do Camisa 7.
- `Reminder`: compatível com documentos legados; estados `pending`, `processing`, `sent` e `failed`.
- `Prediction`, `BolaoTopic`, `GameAlert`, `MatchFeed` e `Camisa7Snapshot`: ver a seção anterior.
- `ActivityEvent`: livro-razão imutável e idempotente de comentários e tópicos, único por comunidade e evento.
- `ActivityBackfillState`: progresso global do backfill iniciado em 01/01/2026.
- `ActivityBackfillTopic`: cursor, lease, retentativas e diagnóstico do backfill de cada tópico.

Jobs e lembretes usam leases e até dez tentativas com backoff. Nunca marque como concluído antes de a VK confirmar a escrita.

## Estatísticas de atividade

Os comandos `!stats`, `!top`, `!sequencia`, `!retrospectiva` e `!recordes` estão publicados e cobrem de 2026 até o ano atual. `!top` limita `N` entre 1 e 20, busca nomes em lote e exclui quem já não é membro; todas as respostas informam o ano.

`ActivityEvent` é a fonte de verdade. Cada documento contém apenas:

- comunidade, usuário, tópico e, para comentários, ID do comentário;
- tipo `comment` ou `topic` e origem `live` ou `backfill`;
- instante, ano e dia civil em `America/Sao_Paulo`;
- indicador de que o comentário era um comando reconhecido.

Não são armazenados texto, nome, foto ou token. IDs de autores negativos — comunidades e bots publicando como comunidade — não entram nas estatísticas. O índice único `{ groupId, eventKey }` torna a janela sobreposta do polling e a concorrência com o backfill seguras. O polling deve registrar os eventos antes de salvar o cursor; se a gravação falhar, a execução deve falhar para que os comentários sejam retomados.

As estatísticas são calculadas por ano a partir de `year`, e dias ativos a partir de `dateKey`. A pontuação do ranking limita 20 comentários e 5 tópicos (peso 3) por dia; o ledger permite alterar a fórmula sem migrar contadores antigos.

### Backfill de 2026

O job `src/jobs/backfill-activity.ts` começa automaticamente no primeiro cron após o deploy e usa como corte `2026-01-01T00:00:00-03:00`. O instante da primeira execução vira o limite superior do snapshot; o polling normal cobre atividades posteriores.

O descobrimento usa `board.getTopics` ordenado por última atualização, não por criação. Isso inclui comentários de 2026 publicados em tópicos antigos. Tópicos fixados são desconsiderados ao decidir que o corte histórico foi alcançado. Por execução, o job lê no máximo duas páginas de 100 tópicos e cinco páginas de 100 comentários, sempre depois das demais etapas e somente se restarem pelo menos doze segundos do orçamento.

Uma medição somente de leitura feita durante a implementação mostrou que as primeiras 20 páginas continham 2.000 tópicos atualizados em 2026 e um teto de 58.328 comentários, mas alcançavam apenas 15/06/2026. Portanto, o backfill completo pode levar muitas horas ou alguns dias. Não aumente os limites por minuto sem medir duração da função, erros VK e consumo da Vercel.

O backfill não cria `CommandJob` nem responde a comandos antigos. Ele apenas insere `ActivityEvent`. Falhas de um tópico usam lease e backoff; após dez tentativas, o tópico fica como `failed` e o estado final será `completed_with_errors`. O resultado de `POST /api/jobs/run` expõe `activityBackfill.status`, métricas da execução, totais acumulados e falhas para acompanhamento.

Limitações inevitáveis: conteúdo ou tópicos apagados não podem ser recuperados; tópicos inacessíveis podem ficar como falha; a “primeira atividade” histórica significa o primeiro evento público recuperável desde 01/01/2026, não a entrada na comunidade. Uma indisponibilidade do cron superior a 24 horas pode criar uma lacuna, pois o guardrail do polling não busca comandos mais antigos. Ao investigar números estranhos, audite `JobState.lastSuccessfulPollAt`; se houver lacunas, implemente um backfill de intervalo que grave somente `ActivityEvent`, sem reprocessar comandos.

## Desenvolvimento

Variáveis obrigatórias estão em `.env.example`: `ACCESS_TOKEN`, `ACCESS_TOKEN_COMMUNITY`, `API_VERSION`, `GROUP_ID`, `MONGODB_URI` e `CRON_SECRET`. `MATCH_TOPIC_ID` é opcional e liga o feed do jogo. Não versionar valores reais.

```bash
npm install
npm run dev
npm run check
npm run test:coverage
```

Use imports ESM com extensão `.js`, mesmo em fontes `.ts`. Antes de entregar mudanças, execute formatação, lint, typecheck, testes e `npm audit`. Testes não podem chamar serviços reais: injete `fetchImpl` nos clientes, um `FootballService` falso em `executeCommand` e use `vi.mock` para os modelos do Mongoose. O `.gitattributes` força LF para que o Prettier passe também no Windows.

## Deploy

A Vercel é o único alvo oficial. O cron-job.org deve chamar `POST https://<dominio>/api/jobs/run` a cada minuto com o mesmo bearer token configurado em `CRON_SECRET`. Não reintroduza configurações de Fly.io, Docker ou cron interno da Vercel.
