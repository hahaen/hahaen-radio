import { buildApp } from '../app.js';
import { readEnvironment } from '../config/environment.js';

try {
  const config = readEnvironment();
  const app = buildApp(config);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    try {
      await app.close();
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  // Configuration errors contain variable names only; never print supplied values.
  console.error(
    error instanceof Error && error.message.startsWith('Invalid environment variables:')
      ? error.message
      : 'API startup failed',
  );
  process.exitCode = 1;
}
