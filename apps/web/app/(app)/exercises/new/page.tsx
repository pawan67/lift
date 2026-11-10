"use client";

import { useRouter } from "next/navigation";

import { ExerciseForm } from "@/components/exercises/exercise-form";
import { PageHeader } from "@/components/ui/page-header";

export default function NewExercisePage() {
  const router = useRouter();
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New exercise"
        subtitle="For a movement the library does not have. It syncs to your phone."
        back={{ href: "/exercises", label: "Exercises" }}
      />
      <ExerciseForm
        onSaved={(id) => router.replace(`/exercises/${encodeURIComponent(id)}`)}
        onCancel={() => router.back()}
      />
    </div>
  );
}
