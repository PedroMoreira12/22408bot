type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    ...(error.cause ? { cause: serializeError(error.cause) } : {}),
  };
}

function sanitize(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (/token|secret|authorization|mongodb|uri/i.test(key)) return [key, '[REDACTED]'];
      if (key === 'error') return [key, serializeError(value)];
      if (key === 'text' || key === 'message') return [key, '[CONTENT REDACTED]'];
      return [key, value];
    }),
  );
}

export function log(level: LogLevel, event: string, context: LogContext = {}): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitize(context),
  });

  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}
