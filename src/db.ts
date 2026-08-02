import mongoose from 'mongoose';

import { getConfig } from './config.js';
import { log } from './lib/logger.js';

declare global {
  var __pimpaoMongoPromise: Promise<typeof mongoose> | undefined;
}

export async function connectDatabase(): Promise<typeof mongoose> {
  if (!globalThis.__pimpaoMongoPromise) {
    globalThis.__pimpaoMongoPromise = mongoose
      .connect(getConfig().mongoUri, {
        maxPoolSize: 5,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5_000,
        socketTimeoutMS: 15_000,
      })
      .then((connection) => {
        log('info', 'mongodb.connected');
        return connection;
      })
      .catch((error: unknown) => {
        globalThis.__pimpaoMongoPromise = undefined;
        throw error;
      });
  }

  return globalThis.__pimpaoMongoPromise;
}
