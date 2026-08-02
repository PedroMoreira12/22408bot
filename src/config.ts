import { z } from 'zod';

const configSchema = z.object({
  ACCESS_TOKEN: z.string().min(1),
  ACCESS_TOKEN_COMMUNITY: z.string().min(1),
  API_VERSION: z.string().regex(/^\d+\.\d+$/),
  GROUP_ID: z.coerce.number().int().positive(),
  MONGODB_URI: z.string().min(1),
  CRON_SECRET: z.string().min(16),
});

export type AppConfig = Readonly<{
  accessToken: string;
  communityAccessToken: string;
  apiVersion: string;
  groupId: number;
  mongoUri: string;
  cronSecret: string;
}>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuração inválida ou ausente: ${missing}`);
  }

  cachedConfig = Object.freeze({
    accessToken: parsed.data.ACCESS_TOKEN,
    communityAccessToken: parsed.data.ACCESS_TOKEN_COMMUNITY,
    apiVersion: parsed.data.API_VERSION,
    groupId: parsed.data.GROUP_ID,
    mongoUri: parsed.data.MONGODB_URI,
    cronSecret: parsed.data.CRON_SECRET,
  });
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = undefined;
}
