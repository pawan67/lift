"use client";

import { useParams, useRouter } from "next/navigation";

import { ExerciseForm } from "@/components/exercises/exercise-form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useModel } from "@/lib/data/model";

export default function EditExercisePage() {
  const router = useRouter();
  const id = decodeURIComponent(useParams<{ id: string }>().id);
  const exercise = useModel().exercises.get(id);
  const detail = `/exercises/${encodeURIComponent(id)}`;

  if (!exercise || !exercise.isCustom || !exercise.row || exercise.isDeleted) {
    return (
      <EmptyState
        title={exercise ? "Library exercises cannot be edited" : "Exercise not found"}
        body={exercise ? "Only exercises you created can be changed. Create a custom one instead." : "It may have been deleted on another device."}
        action={
          <ButtonLink href={exercise ? detail : "/exercises"} variant="secondary">
            Back
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Edit exercise" back={{ href: detail, label: exercise.name }} />
      {/* Keyed so a sync that changes the row mid-edit does not leave stale defaults behind a re-render. */}
      <ExerciseForm key={exercise.id} exercise={exercise} onSaved={() => router.replace(detail)} onCancel={() => router.back()} />
    </div>
  );
}
