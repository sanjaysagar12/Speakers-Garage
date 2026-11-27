import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { loadEnv } from './env';

// apps/server/.env (optional; real deployments set the environment directly)
if (existsSync('.env')) process.loadEnvFile('.env');

let env;
try {
  env = loadEnv();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const { app } = await buildApp({ env });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
