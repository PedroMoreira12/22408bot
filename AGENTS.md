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

Não adicione processos contínuos, `setInterval` ou listeners de Long Poll: a Vercel executa funções sob demanda. O usuário não administra a comunidade monitorada e, portanto, não pode cadastrar Callback API nela.

## API VK

Métodos usados:

- `board.getTopics` e `board.getComments` para polling.
- `board.createComment` para respostas, sempre com `guid` determinístico.
- `users.get` apenas quando `board.getComments?extended=1` não fornece o perfil.
- `messages.send` com token da comunidade e `random_id` determinístico e não zero.

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

O cliente `src/clients/football-schedule.ts` extrai e valida os dados estruturados das páginas públicas de agenda do ge. `!jogo` e `!agenda botafogo` usam a agenda do clube; `!agenda` e `!agenda amanhã` filtram Série A, Copa do Brasil, Libertadores, Sul-Americana e Carioca. O pacote `campeonato-brasileiro-api` permanece exclusivo para `!tabela`. Ambos os clientes usam timeout, retentativa e cache de cinco minutos. Como a fonte de agenda não oferece contrato de API, mantenha testes do parser e falhe explicitamente se a estrutura do HTML mudar.

## Persistência e retentativas

- `CommandJob`: fila durável, única por tópico/comentário.
- `TopicCursor`: último comentário observado por tópico.
- `JobState`: watermark do polling e lease global.
- `Reminder`: compatível com documentos legados; estados `pending`, `processing`, `sent` e `failed`.

Jobs e lembretes usam leases e até dez tentativas com backoff. Nunca marque como concluído antes de a VK confirmar a escrita.

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
