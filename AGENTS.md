# Bot VK — contexto do projeto

## Objetivo

O **Pimpão Bot** responde a comandos publicados nos tópicos de discussão de uma comunidade de torcedores do Botafogo no VK. O projeto usa TypeScript estrito, Node.js 24 e funções serverless da Vercel.

Referência oficial da VK: <https://dev.vk.com/en/reference>. A base das chamadas é `https://api.vk.com/method/{method}` e a versão vem de `API_VERSION`.

## Arquitetura

- `POST /api/jobs/run` é chamado uma vez por minuto pelo cron-job.org com `Authorization: Bearer <CRON_SECRET>`.
- Cada invocação adquire um lease global no MongoDB, consulta tópicos alterados, enfileira comandos novos e processa comandos e lembretes pendentes.
- `GET /api/health` é um health check sem dependência de banco ou configuração.
- Cursores por tópico, jobs únicos por comentário e IDs determinísticos nas escritas VK evitam perda e duplicação.
- A primeira execução inicializa os cursores sem responder a comentários históricos.
- O polling limita a recuperação às últimas 24 horas; comentários mais antigos são ignorados após indisponibilidades prolongadas.
- Cada comentário novo, contenha comando ou não, gera um evento de atividade idempotente antes de o cursor avançar. Tópicos criados por usuários também geram eventos.

Não adicione processos contínuos, `setInterval` ou listeners de Long Poll: a Vercel executa funções sob demanda. O usuário não administra a comunidade monitorada e, portanto, não pode cadastrar Callback API nela.

## API VK

Métodos usados:

- `board.getTopics` e `board.getComments` para polling.
- `board.createComment` para respostas, sempre com `guid` determinístico.
- `users.get` apenas quando `board.getComments?extended=1` não fornece o perfil.
- `messages.send` com token da comunidade e `random_id` determinístico e não zero.

Para estatísticas, `board.getComments` fornece `from_id` e `date`, enquanto `board.getTopics` fornece `created_by` e `created`. A API não fornece a data de entrada de um membro com o token atual: `groups.getMembers?sort=time_asc` exige que o chamador seja moderador. Nunca apresente a primeira atividade observada como se fosse a data de entrada na comunidade.

Centralize chamadas em `src/clients/vk.ts`. Use POST, timeout, envelope validado, rate limiting e retry somente para falhas transitórias. Nunca registre tokens ou corpos completos de comentários.

## Comandos

| Comando            | Comportamento                                     |
| ------------------ | ------------------------------------------------- |
| `!camisa7`         | Informa a quantidade de sócios do plano Camisa 7. |
| `!c [mensagem]`    | Menciona o autor com uma mensagem opcional.       |
| `!gsd`             | Publica a resposta GSD.                           |
| `!antizica`        | Publica a resposta anti-zica.                     |
| `!mongol`          | Publica a resposta anti-GSD.                      |
| `!upem`            | Envia o link fixo do tópico de “upar”.            |
| `!m` / `!mensagem` | Envia o link do tópico por mensagem privada.      |
| `!remind` / `!r`   | Agenda lembrete entre 1 minuto e 365 dias.        |
| `!lembretes`       | Lista até dez lembretes pendentes do autor.       |
| `!jogo`            | Mostra o próximo jogo confirmado do Botafogo.     |
| `!agenda`          | Agenda cinco competições ou jogos do Botafogo.    |
| `!tabela`          | Mostra o Botafogo e seus vizinhos na Série A.     |
| `!tutorial`        | Publica a lista de comandos.                      |

Parsing fica em `src/commands/parser.ts`, execução em `src/commands/execute.ts` e conteúdo em `src/commands/content.ts`. Comandos só são reconhecidos no início do comentário.

O cliente `src/clients/football-schedule.ts` extrai e valida os dados estruturados das páginas públicas de agenda do ge. `!jogo` e `!agenda botafogo` usam a agenda do clube; `!agenda` e `!agenda amanhã` filtram Série A, Copa do Brasil, Libertadores, Sul-Americana e Carioca. `!jogo` também exibe os nomes presentes em `liveWatchSources`; quando a fonte ainda não publicou os canais, responde que a transmissão não foi informada. O pacote `campeonato-brasileiro-api` permanece exclusivo para `!tabela`. Ambos os clientes usam timeout, retentativa e cache de cinco minutos. Como a fonte de agenda não oferece contrato de API, mantenha testes do parser e falhe explicitamente se a estrutura do HTML mudar.

## Persistência e retentativas

- `CommandJob`: fila durável, única por tópico/comentário.
- `TopicCursor`: último comentário observado por tópico.
- `JobState`: watermark do polling e lease global.
- `Reminder`: compatível com documentos legados; estados `pending`, `processing`, `sent` e `failed`.
- `ActivityEvent`: livro-razão imutável e idempotente de comentários e tópicos, único por comunidade e evento.
- `ActivityBackfillState`: progresso global do backfill iniciado em 01/01/2026.
- `ActivityBackfillTopic`: cursor, lease, retentativas e diagnóstico do backfill de cada tópico.

Jobs e lembretes usam leases e até dez tentativas com backoff. Nunca marque como concluído antes de a VK confirmar a escrita.

## Estatísticas de atividade

A coleta está ativa, mas não existem comandos públicos de estatísticas. Não adicione `!stats`, `!perfil`, `!atividade` ou `!top` ao parser ou ao tutorial até cumprir os critérios da seção “Próximos passos”.

`ActivityEvent` é a fonte de verdade. Cada documento contém apenas:

- comunidade, usuário, tópico e, para comentários, ID do comentário;
- tipo `comment` ou `topic` e origem `live` ou `backfill`;
- instante, ano e dia civil em `America/Sao_Paulo`;
- indicador de que o comentário era um comando reconhecido.

Não são armazenados texto, nome, foto ou token. IDs de autores negativos — comunidades e bots publicando como comunidade — não entram nas estatísticas. O índice único `{ groupId, eventKey }` torna a janela sobreposta do polling e a concorrência com o backfill seguras. O polling deve registrar os eventos antes de salvar o cursor; se a gravação falhar, a execução deve falhar para que os comentários sejam retomados.

As estatísticas serão calculadas por ano a partir de `year`, e dias ativos a partir de `dateKey`. O ledger permite alterar a fórmula de pontuação futuramente sem migrar contadores antigos.

### Backfill de 2026

O job `src/jobs/backfill-activity.ts` começa automaticamente no primeiro cron após o deploy e usa como corte `2026-01-01T00:00:00-03:00`. O instante da primeira execução vira o limite superior do snapshot; o polling normal cobre atividades posteriores.

O descobrimento usa `board.getTopics` ordenado por última atualização, não por criação. Isso inclui comentários de 2026 publicados em tópicos antigos. Tópicos fixados são desconsiderados ao decidir que o corte histórico foi alcançado. Por execução, o job lê no máximo duas páginas de 100 tópicos e cinco páginas de 100 comentários, sempre depois de polling, comandos e lembretes e somente se restarem pelo menos doze segundos do orçamento.

Uma medição somente de leitura feita durante a implementação mostrou que as primeiras 20 páginas continham 2.000 tópicos atualizados em 2026 e um teto de 58.328 comentários, mas alcançavam apenas 15/06/2026. Portanto, o backfill completo pode levar muitas horas ou alguns dias. Não aumente os limites por minuto sem medir duração da função, erros VK e consumo da Vercel.

O backfill não cria `CommandJob` nem responde a comandos antigos. Ele apenas insere `ActivityEvent`. Falhas de um tópico usam lease e backoff; após dez tentativas, o tópico fica como `failed` e o estado final será `completed_with_errors`. O resultado de `POST /api/jobs/run` expõe `activityBackfill.status`, métricas da execução, totais acumulados e falhas para acompanhamento.

Limitações inevitáveis: conteúdo ou tópicos apagados não podem ser recuperados; tópicos inacessíveis podem ficar como falha; a “primeira atividade” histórica significa o primeiro evento público recuperável desde 01/01/2026, não a entrada na comunidade. Depois que o backfill inicial terminar, uma indisponibilidade do cron superior a 24 horas pode criar uma lacuna, pois o guardrail do polling não busca comandos mais antigos. Antes de publicar rankings, audite `JobState.lastSuccessfulPollAt`; se houver lacunas, implemente um novo backfill de intervalo que grave somente `ActivityEvent`, sem reprocessar comandos.

### Próximos passos

Com o backfill concluído, os comandos de estatísticas podem ser implementados quando:

1. `activityBackfill.status` estiver `completed` ou todas as causas de `completed_with_errors` tiverem sido avaliadas;
2. o ledger tiver volume suficiente para um ranking útil — referência inicial: ao menos 1.000 eventos válidos e 30 membros distintos;
3. uma consulta de auditoria confirmar ausência de duplicatas, anos corretos e distribuição plausível por usuário;
4. a comunidade aprovar uma fórmula transparente e resistente a spam.

Na etapa futura, criar agregação anual materializada a partir de `ActivityEvent`, sem alterar o ledger. Sugestão inicial: totais brutos de comentários e tópicos; dias ativos distintos; primeira e última atividade; comandos separados; pontuação diária limitada. `!stats [ano]` deve consultar somente o autor, e `!top N [ano]` deve limitar `N` entre 1 e 20, buscar perfis em lote e excluir contas que já não sejam membros. Todas as respostas devem informar o ano e a data inicial da cobertura.

## Desenvolvimento

Variáveis obrigatórias estão em `.env.example`: `ACCESS_TOKEN`, `ACCESS_TOKEN_COMMUNITY`, `API_VERSION`, `GROUP_ID`, `MONGODB_URI` e `CRON_SECRET`. Não versionar valores reais.

```bash
npm install
npm run dev
npm run check
npm run test:coverage
```

Use imports ESM com extensão `.js`, mesmo em fontes `.ts`. Antes de entregar mudanças, execute formatação, lint, typecheck, testes e `npm audit`. Testes não podem chamar serviços reais.

## Deploy

A Vercel é o único alvo oficial. O cron-job.org deve chamar `POST https://<dominio>/api/jobs/run` a cada minuto com o mesmo bearer token configurado em `CRON_SECRET`. Não reintroduza configurações de Fly.io, Docker ou cron interno da Vercel.
