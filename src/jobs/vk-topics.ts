import type { VkClient } from '../clients/vk.js';

/** Tópicos fixados vêm sempre primeiro no `board.getTopics`, mesmo ordenando por criação. */
const DUPLICATE_CHECK_TOPICS = 50;

/**
 * Cria o tópico, a menos que uma tentativa anterior já o tenha criado sem conseguir registrar o
 * sucesso: `board.addTopic` não aceita `guid`, então a duplicata é procurada pelo título.
 */
export async function findOrAddTopic(vk: VkClient, title: string, text: string): Promise<number> {
  const recent = await vk.getTopics(0, DUPLICATE_CHECK_TOPICS, 2);
  const existing = recent.items.find((topic) => normalizeTitle(topic.title) === title);
  return existing ? existing.id : vk.addTopic(title, text);
}

/** A VK devolve títulos com entidades HTML para alguns caracteres. */
function normalizeTitle(title: string): string {
  return title
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .trim();
}
