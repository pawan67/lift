/**
 * Every nutrient as a typed field: calories and the three macros up top, the
 * rest folded beneath by group, the user's own nutrients last.
 *
 * Values are strings while editing ("1." is a state a number passes through),
 * converted with `parseNutrientDraft` on save. Blank means "not known" and is
 * stored as a missing key, never as zero. Same rules as the phone's form.
 */

"use client";

import {
  BUILT_IN_NUTRIENTS,
  CORE_NUTRIENT_KEYS,
  NUTRIENT_GROUP_LABELS,
  type CustomNutrient,
  type NutrientDefinition,
  type NutrientGroup,
  type NutrientValues,
} from "@lift/shared";
import { ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useId, useState } from "react";

import { fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export type NutrientDraft = Record<string, string>;

export function toNutrientDraft(values: NutrientValues): NutrientDraft {
  const out: NutrientDraft = {};
  for (const [key, value] of Object.entries(values)) out[key] = String(Math.round(value * 100) / 100);
  return out;
}

export function parseNutrientDraft(draft: NutrientDraft): NutrientValues {
  const out: NutrientValues = {};
  for (const [key, text] of Object.entries(draft)) {
    const value = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

const GROUP_ORDER: NutrientGroup[] = ["fats", "carbs", "minerals", "vitamins"];

function customDefinition(custom: CustomNutrient): NutrientDefinition {
  return { key: custom.id, label: custom.name, short: custom.name, unit: custom.unit as NutrientDefinition["unit"], group: "custom", decimals: 1 };
}

function NumberField({ definition, value, onChange, large }: { definition: NutrientDefinition; value: string; onChange: (v: string) => void; large?: boolean }) {
  const id = useId();
  if (large) {
    return (
      <label htmlFor={id} className="block rounded-lg border border-line bg-surface-2 px-3 pt-2 pb-1.5 transition-colors focus-within:border-volt/60 focus-within:shadow-[0_0_0_3px_var(--ring)]">
        <span className="block text-xs text-fg-3">{definition.label}</span>
        <span className="flex items-baseline gap-1">
          <input
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            placeholder="–"
            aria-label={`${definition.label} in ${definition.unit}`}
            className="tabular w-full min-w-0 bg-transparent text-xl font-semibold text-fg outline-none placeholder:text-fg-3"
          />
          <span className="text-xs text-fg-3">{definition.unit}</span>
        </span>
      </label>
    );
  }
  return (
    <div className="flex items-center gap-3 py-1">
      <label htmlFor={id} className="flex-1 text-sm text-fg-2">
        {definition.label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))}
        inputMode="decimal"
        placeholder="–"
        aria-label={`${definition.label} in ${definition.unit}`}
        className={fieldClass({ className: "tabular h-8 w-24 px-2.5 text-right" })}
      />
      <span className="w-7 text-xs text-fg-3">{definition.unit}</span>
    </div>
  );
}

export function NutrientFields({
  value,
  onChange,
  customNutrients,
  defaultOpen,
}: {
  value: NutrientDraft;
  onChange: (next: NutrientDraft) => void;
  customNutrients: readonly CustomNutrient[];
  defaultOpen?: boolean;
}) {
  const hasExtra = Object.entries(value).some(([key, text]) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(key) && text.trim() !== "");
  const [open, setOpen] = useState(defaultOpen ?? hasExtra);
  const set = (key: string) => (text: string) => onChange({ ...value, [key]: text });
  const core = BUILT_IN_NUTRIENTS.filter((n) => (CORE_NUTRIENT_KEYS as readonly string[]).includes(n.key));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {core.map((definition) => (
          <NumberField key={definition.key} definition={definition} value={value[definition.key] ?? ""} onChange={set(definition.key)} large />
        ))}
      </div>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="press inline-flex items-center gap-1 rounded-md py-1 text-[13px] font-medium text-volt hover:underline">
          {open ? "Fewer nutrients" : "More nutrients"}
          <ChevronDown size={15} className={cn("transition-transform duration-150", open && "rotate-180")} />
        </Collapsible.Trigger>
        <Collapsible.Content className="mt-2 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {GROUP_ORDER.map((group) => (
            <section key={group}>
              <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">{NUTRIENT_GROUP_LABELS[group]}</h4>
              {BUILT_IN_NUTRIENTS.filter((n) => n.group === group).map((definition) => (
                <NumberField key={definition.key} definition={definition} value={value[definition.key] ?? ""} onChange={set(definition.key)} />
              ))}
            </section>
          ))}
          {customNutrients.length > 0 ? (
            <section>
              <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">{NUTRIENT_GROUP_LABELS.custom}</h4>
              {customNutrients.map((custom) => (
                <NumberField key={custom.id} definition={customDefinition(custom)} value={value[custom.id] ?? ""} onChange={set(custom.id)} />
              ))}
            </section>
          ) : null}
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
