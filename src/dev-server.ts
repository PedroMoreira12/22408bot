import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { GET as healthGet } from '../api/health.js';
import { GET as jobGet, POST as jobPost } from '../api/jobs/run.js';

const port = Number(process.env.PORT ?? 8080);

createServer((incoming, outgoing) => {
  void handleHttpRequest(incoming, outgoing);
}).listen(port, () => {
  console.log(`Servidor local em http://localhost:${port}`);
});

async function handleHttpRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const origin = `http://${incoming.headers.host ?? `localhost:${port}`}`;
  const request = new Request(new URL(incoming.url ?? '/', origin), {
    method: incoming.method ?? 'GET',
    headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]],
    ),
  });

  let response: Response;
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/health') {
    response = healthGet();
  } else if (new URL(request.url).pathname === '/api/jobs/run') {
    response = request.method === 'POST' ? await jobPost(request) : jobGet();
  } else {
    response = healthGet();
  }

  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
