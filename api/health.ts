export function GET(): Response {
  return Response.json({ status: 'ok', service: 'pimpao-bot-vk' });
}

export function POST(): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
}
