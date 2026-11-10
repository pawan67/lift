"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useModel } from "@/lib/data/model";
import { createRoutine } from "@/lib/routines/repository";

function NewRoutineForm() {
  const model = useModel();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("folder");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [folderId, setFolderId] = useState<string>(
    requested && model.folders.some((folder) => folder.id === requested) ? requested : "",
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const id = await createRoutine({ name: name.trim() || "New Routine", folderId: folderId || null, notes });
    // The editor opens straight onto "Add exercises", the next thing to do.
    router.replace(`/routines/${id}?add=1`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New routine" back={{ href: "/routines", label: "Routines" }} />
      <Card>
        <form onSubmit={submit} className="space-y-4 p-5">
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Push A, Leg day"
              maxLength={80}
              data-autofocus
              autoFocus
            />
          </Field>
          {model.folders.length > 0 ? (
            <Field label="Folder">
              <Select
                value={folderId}
                onValueChange={setFolderId}
                aria-label="Folder"
                options={[{ value: "", label: "No folder" }, ...model.folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
              />
            </Field>
          ) : null}
          <Field label="Notes" hint="Optional. Shown on your phone when you start the routine.">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Create and add exercises
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function NewRoutinePage() {
  return (
    <Suspense>
      <NewRoutineForm />
    </Suspense>
  );
}
