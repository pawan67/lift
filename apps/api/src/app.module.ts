import { Controller, Get, Module } from '@nestjs/common';

import { sql } from './db/client.js';
import { NutritionModule } from './nutrition/nutrition.module.js';
import { SyncModule } from './sync/sync.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Controller()
class HealthController {
  /**
   * Liveness + readiness in one.
   *
   * Actually round-trips to Postgres rather than returning a bare 200: a
   * process that's up but can't reach its database is not healthy, and Dokploy
   * should restart it.
   */
  @Get('health')
  async health() {
    await sql`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Module({
  imports: [SyncModule, TelegramModule, NutritionModule],
  controllers: [HealthController],
})
export class AppModule {}
