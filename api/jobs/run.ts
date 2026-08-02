import { getConfig } from '../../src/config.js';
import { hasValidBearerToken } from '../../src/http/auth.js';
import { runBotJob } from '../../src/jobs/run.js';
import { log } from '../../src/lib/logger.js';

export async function POST(request: Request): Promise<Response> {
  let config;
  try {
    config = getConfig();
  } catch (error) {
    log('error', 'config.invalid', { error });
    return Response.json({ error: 'Configuração do servidor inválida' }, { status: 500 });
  }

  if (!hasValidBearerToken(request, config.cronSecret)) {
    return Response.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    return Response.json(await runBotJob());
  } catch (error) {
    log('error', 'job.failed', { error });
    return Response.json({ error: 'Falha ao executar o job' }, { status: 500 });
  }
}

export function GET(): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
