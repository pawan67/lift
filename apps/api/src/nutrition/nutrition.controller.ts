/**
 * `/api/nutrition/*`: the food tracker's HTTP surface.
 *
 * Every route is the signed-in user's own data. Bodies and query strings are
 * parsed with the schemas in `@lift/shared`, the same ones the app's client is
 * typed against, so a request the app can build is a request this accepts.
 */

import {
  copyEntriesSchema,
  createEntriesSchema,
  customNutrientInputSchema,
  deleteEntriesSchema,
  entryPatchSchema,
  foodInputSchema,
  foodPatchSchema,
  goalsInputSchema,
  isoDate,
  logTemplateSchema,
  nutritionStatsQuerySchema,
  templateInputSchema,
  templatePatchSchema,
  type CustomNutrient,
  type DaySummary,
  type DiaryDay,
  type Food,
  type FoodCandidate,
  type FoodEntry,
  type FoodSearchResult,
  type MealTemplate,
  type NutritionGoals,
  type NutritionProfile,
  type NutritionStats,
  type RecentItem,
} from '@lift/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';

import { NutritionService } from './nutrition.service.js';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}

const dayQuery = z.object({ date: isoDate });

/** A year at most: the trend chart's widest view, and a bound on the scan. */
const summaryQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine(({ from, to }) => from <= to, 'from must not be after to.')
  .refine(
    ({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86_400_000 <= 400,
    'A range of at most a year.',
  );

const limitQuery = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

const foodsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  favorites: z.enum(['true', 'false']).optional(),
  limit: limitQuery(50, 200),
});

const searchQuery = z.object({ q: z.string().trim().min(2, 'Type at least two letters.').max(100) });

const barcodeParam = z.string().regex(/^\d{6,14}$/, 'Not a barcode.');

const idParam = z.string().min(1).max(64);

@Controller('nutrition')
@UseGuards(AuthGuard)
export class NutritionController {
  constructor(private readonly nutrition: NutritionService) {}

  // Profile ------------------------------------------------------------------

  @Get('profile')
  profile(@Req() request: AuthedRequest): Promise<NutritionProfile> {
    return this.nutrition.profile(request.userId);
  }

  @Put('goals')
  setGoals(@Req() request: AuthedRequest, @Body() body: unknown): Promise<NutritionGoals> {
    return this.nutrition.setGoals(request.userId, parse(goalsInputSchema, body));
  }

  @Post('nutrients')
  createNutrient(@Req() request: AuthedRequest, @Body() body: unknown): Promise<CustomNutrient> {
    return this.nutrition.createCustomNutrient(request.userId, parse(customNutrientInputSchema, body));
  }

  @Patch('nutrients/:id')
  updateNutrient(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CustomNutrient> {
    return this.nutrition.updateCustomNutrient(
      request.userId,
      parse(idParam, id),
      parse(customNutrientInputSchema.partial(), body),
    );
  }

  @Delete('nutrients/:id')
  @HttpCode(204)
  async deleteNutrient(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.nutrition.deleteCustomNutrient(request.userId, parse(idParam, id));
  }

  // Diary --------------------------------------------------------------------

  @Get('day')
  day(@Req() request: AuthedRequest, @Query() query: unknown): Promise<DiaryDay> {
    return this.nutrition.day(request.userId, parse(dayQuery, query).date);
  }

  @Get('summary')
  summary(@Req() request: AuthedRequest, @Query() query: unknown): Promise<DaySummary[]> {
    const { from, to } = parse(summaryQuery, query);
    return this.nutrition.summary(request.userId, from, to);
  }

  /** The statistics screens: one call per range, everything they draw. */
  @Get('stats')
  stats(@Req() request: AuthedRequest, @Query() query: unknown): Promise<NutritionStats> {
    return this.nutrition.stats(request.userId, parse(nutritionStatsQuerySchema, query));
  }

  @Post('entries')
  createEntries(@Req() request: AuthedRequest, @Body() body: unknown): Promise<FoodEntry[]> {
    return this.nutrition.createEntries(request.userId, parse(createEntriesSchema, body));
  }

  @Patch('entries/:id')
  updateEntry(@Req() request: AuthedRequest, @Param('id') id: string, @Body() body: unknown): Promise<FoodEntry> {
    return this.nutrition.updateEntry(request.userId, parse(idParam, id), parse(entryPatchSchema, body));
  }

  @Post('entries/delete')
  @HttpCode(204)
  async deleteEntries(@Req() request: AuthedRequest, @Body() body: unknown): Promise<void> {
    await this.nutrition.deleteEntries(request.userId, parse(deleteEntriesSchema, body).ids);
  }

  @Post('entries/copy')
  copyEntries(@Req() request: AuthedRequest, @Body() body: unknown): Promise<FoodEntry[]> {
    return this.nutrition.copyEntries(request.userId, parse(copyEntriesSchema, body));
  }

  @Get('recents')
  recents(@Req() request: AuthedRequest, @Query() query: unknown): Promise<RecentItem[]> {
    const { limit } = parse(z.object({ limit: limitQuery(30, 100) }), query);
    return this.nutrition.recents(request.userId, limit);
  }

  // Foods --------------------------------------------------------------------

  @Get('foods')
  foods(@Req() request: AuthedRequest, @Query() query: unknown): Promise<Food[]> {
    const { q, favorites, limit } = parse(foodsQuery, query);
    return this.nutrition.listFoods(request.userId, { query: q || undefined, favorites: favorites === 'true', limit });
  }

  @Post('foods')
  createFood(@Req() request: AuthedRequest, @Body() body: unknown): Promise<Food> {
    return this.nutrition.createFood(request.userId, parse(foodInputSchema, body));
  }

  @Patch('foods/:id')
  updateFood(@Req() request: AuthedRequest, @Param('id') id: string, @Body() body: unknown): Promise<Food> {
    return this.nutrition.updateFood(request.userId, parse(idParam, id), parse(foodPatchSchema, body));
  }

  @Delete('foods/:id')
  @HttpCode(204)
  async deleteFood(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.nutrition.deleteFood(request.userId, parse(idParam, id));
  }

  @Get('search')
  search(@Req() request: AuthedRequest, @Query() query: unknown): Promise<FoodSearchResult> {
    return this.nutrition.search(request.userId, parse(searchQuery, query).q);
  }

  @Get('barcode/:code')
  barcode(@Req() request: AuthedRequest, @Param('code') code: string): Promise<{ food: Food | FoodCandidate | null }> {
    return this.nutrition.barcode(request.userId, parse(barcodeParam, code));
  }

  // Templates ----------------------------------------------------------------

  @Get('templates')
  templates(@Req() request: AuthedRequest): Promise<MealTemplate[]> {
    return this.nutrition.templates(request.userId);
  }

  @Post('templates')
  createTemplate(@Req() request: AuthedRequest, @Body() body: unknown): Promise<MealTemplate> {
    return this.nutrition.createTemplate(request.userId, parse(templateInputSchema, body));
  }

  @Patch('templates/:id')
  updateTemplate(@Req() request: AuthedRequest, @Param('id') id: string, @Body() body: unknown): Promise<MealTemplate> {
    return this.nutrition.updateTemplate(request.userId, parse(idParam, id), parse(templatePatchSchema, body));
  }

  @Delete('templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.nutrition.deleteTemplate(request.userId, parse(idParam, id));
  }

  @Post('templates/:id/log')
  logTemplate(@Req() request: AuthedRequest, @Param('id') id: string, @Body() body: unknown): Promise<FoodEntry[]> {
    return this.nutrition.logTemplate(request.userId, parse(idParam, id), parse(logTemplateSchema, body));
  }
}
