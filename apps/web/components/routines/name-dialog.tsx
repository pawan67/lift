/** Asks for a name: new folder, folder rename. */

"use client";

import { useState, type FormEvent } from "react";

import { Dialog } from "@/components/ui/dialog";
import { Button, Field, Input } from "@/components/ui/primitives";

export function NameDialog({
  open,
  onClose,
  title,
  label = "Name",
  initial = "",
  placeholder,
  confirmLabel = "Save",
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm">
      {/* Keyed on open so each opening starts from `initial`. */}
      {open ? (
        <NameForm
          key={initial}
          label={label}
          initial={initial}
          placeholder={placeholder}
          confirmLabel={confirmLabel}
          onCancel={onClose}
          onSubmit={async (name) => {
            await onSubmit(name);
            onClose();
          }}
        />
      ) : null}
    </Dialog>
  );
}

function NameForm({
  label,
  initial,
  placeholder,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="px-5 py-4">
        <Field label={label}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={placeholder} maxLength={80} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
