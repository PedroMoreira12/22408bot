# Pimpão Bot VK

Bot serverless para comandos nos tópicos de discussão do VK. O cron-job.org aciona uma função curta na Vercel; MongoDB mantém cursores, fila de comandos e lembretes.

O polling recupera no máximo as últimas 24 horas de atividade. Após uma interrupção mais longa, comentários anteriores a essa janela são ignorados e os cursores avançam sem executar comandos antigos.

## Comandos esportivos e lembretes

- `!jogo`, `!proximo`, `!proximojogo`: próximo jogo confirmado do Botafogo em qualquer competição.
- `!agenda`, `!agenda amanhã`: jogos da Série A, Copa do Brasil, Libertadores, Sul-Americana e Carioca.
- `!agenda botafogo`: próximos jogos confirmados do Botafogo.
- `!tabela`, `!classificacao`, `!brasileirao`: Botafogo e clubes próximos na tabela.
- `!lembretes`, `!meuslembretes`: até dez lembretes pendentes do autor.

Agenda e próximos jogos vêm das páginas públicas de agenda do ge; a tabela da Série A usa `campeonato-brasileiro-api`. As respostas são validadas antes do uso e mantidas em cache por cinco minutos. Nenhuma chave esportiva adicional é necessária.

## Configuração

1. Use Node.js 24 e execute `npm install`.
2. Copie `.env.example` para `.env` e preencha os valores localmente.
3. Gere `CRON_SECRET` com pelo menos 16 caracteres e cadastre o mesmo valor nas variáveis da Vercel.
4. Execute `npm run check` antes do deploy.

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

Documentação da API VK: <https://dev.vk.com/en/reference>.
