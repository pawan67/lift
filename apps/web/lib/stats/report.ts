/**
 * The training report's input, from the model instead of SQLite.
 *
 * Mirrors `apps/mobile/src/features/report/repository.ts`: every finished
 * session before the end of the window (the model only holds finished ones),
 * because `buildTrainingReport` needs the earlier history to tell a new record
 * from an old one.
 */

import type { ReportFonts, ReportWorkoutRow, TrainingReport } from "@lift/shared/report";

import type { Model } from "../data/model";

export function reportWorkouts(model: Model, to: number): ReportWorkoutRow[] {
  const rows: ReportWorkoutRow[] = [];
  for (const session of model.sessions) {
    if (session.startedAt >= to) continue;
    rows.push({
      id: session.id,
      name: session.name,
      startedAt: session.startedAt,
      durationSeconds: session.durationSeconds,
      sets: session.exercises.flatMap((block) =>
        block.sets.map((set) => ({
          exerciseId: block.exercise.id,
          exerciseName: block.exercise.name,
          primaryMuscle: block.exercise.primaryMuscle,
          trackingType: block.exercise.trackingType,
          setType: set.setType,
          weightKg: set.weightKg,
          reps: set.reps,
          durationSeconds: set.durationSeconds,
          distanceKm: set.distanceKm,
          isCompleted: set.isCompleted,
        })),
      ),
    });
  }
  return rows.sort((a, b) => a.startedAt - b.startedAt);
}

let fonts: Promise<ReportFonts> | null = null;

/** The PDF's faces, the same JetBrains Sans files the phone embeds, served from `public/fonts`. */
function loadFonts(): Promise<ReportFonts> {
  fonts ??= (async () => {
    const read = async (name: string) => {
      const response = await fetch(`/fonts/${name}`);
      if (!response.ok) throw new Error(`Could not load the report font ${name}.`);
      return new Uint8Array(await response.arrayBuffer());
    };
    const [regular, semibold, bold] = await Promise.all([
      read("JetBrainsSans-Regular.ttf"),
      read("JetBrainsSans-SemiBold.ttf"),
      read("JetBrainsSans-Bold.ttf"),
    ]);
    return { regular, semibold, bold };
  })();
  fonts.catch(() => {
    fonts = null;
  });
  return fonts;
}

/** Renders the report to a PDF and hands it to the browser as a download. */
export async function downloadReportPdf(report: TrainingReport): Promise<void> {
  // Imported on demand so nothing but the report route ever pulls pdf-lib in.
  const [{ renderReportPdf, reportTitle }, fontBytes] = await Promise.all([import("@lift/shared/report"), loadFonts()]);
  const bytes = await renderReportPdf(report, fontBytes);
  const end = new Date(report.to - 1).toISOString().slice(0, 10);
  const name = `lift-${reportTitle(report.days).toLowerCase().replace(/\s+/g, "-")}-${end}.pdf`;

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
