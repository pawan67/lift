import 'reflect-metadata';

import { toNodeHandler } from 'better-auth/node';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import express from 'express';
import net from 'node:net';

import { AppModule } from './app.module.js';
import { auth } from './auth/auth.js';
import { runMigrations } from './db/migrate.js';

/**
 * How long one address gets to connect before Node tries the next.
 *
 * Node's default is 250 ms, which assumes every host is nearby. USDA's
 * FoodData Central regularly takes longer than that just to open a TCP
 * connection, so with the default every address is abandoned in turn and the
 * request fails with "fetch failed" while curl, which waits, succeeds. Each
 * caller still has its own overall timeout; this only stops Node giving up on
 * a slow handshake early.
 */
net.setDefaultAutoSelectFamilyAttemptTimeout(2_000);

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Before the server exists, so no request can reach a schema that isn't there.
  await runMigrations();

  /**
   * Body parsing is disabled here and re-enabled below, after the auth routes.
   *
   * better-auth reads the raw request body itself. If Express has already
   * consumed the stream, every sign-in POST arrives empty and fails in a way
   * that looks like bad credentials rather than a middleware ordering bug.
   */
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: trustedOrigins.length > 0 ? trustedOrigins : true,
    credentials: true,
  });

  // Auth first, on the raw stream…
  app.use('/api/auth/*splat', toNodeHandler(auth));

  // Firefox strictly requires CORP when the web app uses COEP: credentialless
  // and makes cross-origin requests with credentials (like sync).
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });

  // …then JSON parsing for everything else. Sync batches can be large after a
  // long offline stretch, so the default 100kb limit is raised.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.setGlobalPrefix('api', {
    // The auth routes are mounted directly above and must not be prefixed twice.
    exclude: ['health'],
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`Lift API listening on :${port}`);

  /*
   * Said out loud at boot, because getting it wrong is invisible from here.
   *
   * A browser whose origin is missing from this list is refused by the CORS
   * middleware above and again by better-auth, and the only place either
   * refusal appears is that browser's console: as a CORS error, which reads
   * as a networking problem rather than as a list this server was started
   * with. The phone app never exercises it: a native fetch sends no Origin,
   * so the whole path stays untested until the day the web app is deployed.
   *
   * The empty case is worth its own line rather than an empty one. It does not
   * mean "no origins": `enableCors` falls back to reflecting whatever asked,
   * with credentials, which is every origin on the internet.
   */
  logger.log(
    trustedOrigins.length > 0
      ? `Trusted origins: ${trustedOrigins.join(', ')}`
      : 'Trusted origins: none set. Every origin is allowed. Set TRUSTED_ORIGINS.',
  );
}

bootstrap().catch((error) => {
  // A failed migration or an unreachable database must exit non-zero: the
  // deploy should be reported as failed, not left as a container that is up
  // and answering nothing.
  new Logger('Bootstrap').error(error);
  process.exit(1);
});
