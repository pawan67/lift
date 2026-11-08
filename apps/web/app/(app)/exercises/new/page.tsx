"use client";

import { useRouter } from "next/navigation";

import { ExerciseForm } from "@/components/exercises/exercise-form";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";

export default function NewExercisePage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New exercise"
        subtitle="For a movement the library does not have. It syncs to your phone."
        back={{ href: "/exercises", label: "Exercises" }}
      />
      <Card>
        <CardBody className="pt-5">
          <ExerciseForm
            onSaved={(id) => router.replace(`/exercises/${encodeURIComponent(id)}`)}
            onCancel={() => router.back()}
          />
        </CardBody>
      </Card>
    </div>
  );
}
