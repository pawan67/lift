/**
 * Describe a meal, or photograph it, and have a model estimate it.
 *
 * Nothing is logged until the estimate has been looked at: a model guessing
 * at a plate is wrong often enough that the review below is the feature, not
 * a formality. Each item can be renamed, its amount changed and every figure
 * corrected before "Log" writes them as ordinary diary entries.
 *
 * The key is the browser's own (see `lib/nutrition/ai.ts`), so the first visit
 * opens on a short setup form instead of the estimate.
 */

"use client";

import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  DEFAULT_AI_MODELS,
  DEFAULT_BASE_URLS,
  MEAL_LABELS,
  confidenceLabel,
  formatCalories,
  formatQuantity,
  itemTotals,
  totalsOf,
  type AiImage,
  type AiProvider,
  type EstimatedItem,
  type Meal,
} from "@lift/shared";
import { Check, ImagePlus, Minus, Plus, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { Checkbox } from "radix-ui";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea, fieldClass } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { nutritionApi } from "@/lib/nutrition/api";
import { EstimateError, estimateFood, fileToAiImage, useAiSetup, type AiSetup } from "@/lib/nutrition/ai";
import { describeError, invalidateFoods, useCreateEntries, useNutritionProfile } from "@/lib/nutrition/queries";

import { NutrientFields, parseNutrientDraft, toNutrientDraft, type NutrientDraft } from "./nutrient-fields";
import { MacroLine } from "./summary";

const CONFIDENCE_TONES: Record<"low" | "medium" | "high", BadgeTone> = { low: "warn", medium: "neutral", high: "signal" };

/** `initialDescription`, from the add dialog's search, is estimated as soon as the dialog opens. */
export function EstimateDialog({
  open,
  onClose,
  date,
  meal,
  initialDescription,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  meal: Meal;
  initialDescription?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Estimate with AI" description={`Into ${MEAL_LABELS[meal].toLowerCase()}`} size="lg">
      {/* Remounted per open, so each opening starts clean and a pending request dies with it. */}
      {open ? <EstimateBody date={date} meal={meal} onDone={onClose} initialDescription={initialDescription} /> : null}
    </Dialog>
  );
}

function EstimateBody({ date, meal, onDone, initialDescription }: { date: string; meal: Meal; onDone: () => void; initialDescription?: string }) {
  const apiKey = useAiSetup((state) => state.apiKey);
  const [settingUp, setSettingUp] = useState(!apiKey);

  if (settingUp || !apiKey) return <SetupForm onSaved={() => setSettingUp(false)} onCancel={apiKey ? () => setSettingUp(false) : undefined} />;
  return <Estimator date={date} meal={meal} onDone={onDone} onSettings={() => setSettingUp(true)} initialDescription={initialDescription} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function SetupForm({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const current = useAiSetup();
  const [draft, setDraft] = useState<AiSetup>({
    provider: current.provider,
    model: current.model,
    baseUrl: current.baseUrl,
    apiKey: current.apiKey,
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AiSetup>(key: K, value: AiSetup[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="space-y-4 px-5 pb-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.apiKey.trim()) {
          setError("Paste your API key.");
          return;
        }
        current.save(draft);
        toast("AI is set up");
        onSaved();
      }}
    >
      <p className="text-sm text-fg-3">
        Estimates use your own AI account. The key is kept in this browser only and goes straight to the provider; the Lift server never sees it. The phone
        app keeps its own key.
      </p>
      <Field label="Provider">
        <Select<AiProvider>
          value={draft.provider}
          onValueChange={(value) => set("provider", value)}
          options={AI_PROVIDERS.map((provider) => ({ value: provider, label: AI_PROVIDER_LABELS[provider] }))}
          aria-label="Provider"
          className="w-full"
        />
      </Field>
      <Field label="Model" hint="Leave empty for the default. Photos need a model that can see images.">
        <Input value={draft.model} onChange={(event) => set("model", event.target.value)} placeholder={DEFAULT_AI_MODELS[draft.provider]} />
      </Field>
      {draft.provider === "openai-compatible" ? (
        <Field label="Address" hint="OpenAI, OpenRouter, Ollama or any compatible server.">
          <Input value={draft.baseUrl} onChange={(event) => set("baseUrl", event.target.value)} placeholder={DEFAULT_BASE_URLS[draft.provider]} />
        </Field>
      ) : null}
      <Field label="API key" error={error}>
        <Input
          type="password"
          autoComplete="off"
          value={draft.apiKey}
          onChange={(event) => {
            setError(null);
            set("apiKey", event.target.value);
          }}
          placeholder="sk-..."
          data-autofocus
        />
      </Field>
      <div className="flex items-center justify-between gap-2 pt-1">
        {current.apiKey ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              current.forget();
              setDraft({ provider: "anthropic", model: "", baseUrl: "", apiKey: "" });
              toast("Key removed from this browser", "info");
            }}
          >
            Remove key
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Estimate and review
// ---------------------------------------------------------------------------

interface ReviewItem extends EstimatedItem {
  key: string;
  quantityText: string;
  editing: boolean;
  draft: NutrientDraft;
}

function toReview(items: EstimatedItem[]): ReviewItem[] {
  return items.map((item, index) => ({
    ...item,
    key: `${index}-${item.name}`,
    quantityText: formatQuantity(item.quantity),
    editing: false,
    draft: toNutrientDraft(item.nutrients),
  }));
}

/** The item as it will be logged: typed amount and corrected figures applied. */
function settled(item: ReviewItem): EstimatedItem {
  const typed = Number(item.quantityText.replace(",", "."));
  const quantity = Number.isFinite(typed) && typed > 0 ? typed : item.quantity;
  return { ...item, quantity, nutrients: item.editing ? parseNutrientDraft(item.draft) : item.nutrients };
}

function Estimator({
  date,
  meal,
  onDone,
  onSettings,
  initialDescription,
}: {
  date: string;
  meal: Meal;
  onDone: () => void;
  onSettings: () => void;
  initialDescription?: string;
}) {
  const provider = useAiSetup((state) => state.provider);
  const profile = useNutritionProfile();
  const customNutrients = profile.data?.customNutrients ?? [];
  const create = useCreateEntries();

  const [description, setDescription] = useState(initialDescription?.slice(0, 600) ?? "");
  const [image, setImage] = useState<{ ai: AiImage; preview: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saveFoods, setSaveFoods] = useState(false);
  const [logging, setLogging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  // Closing the dialog unmounts this, and a request still in flight is
  // abandoned rather than left to finish into a screen that is gone.
  useEffect(() => () => controller.current?.abort(), []);

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const ai = await fileToAiImage(file);
      setImage({ ai, preview: `data:${ai.mediaType};base64,${ai.data}` });
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  function onPaste(event: ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      void takeFile(file);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void takeFile(Array.from(event.dataTransfer.files).find((f) => f.type.startsWith("image/")));
  }

  async function run() {
    if (!description.trim() && !image) {
      setError("Describe the meal or add a photo.");
      return;
    }
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setError(null);
    try {
      const estimate = await estimateFood({ description, image: image?.ai ?? null, customNutrients, signal: next.signal });
      setItems(toReview(estimate.items));
      setNote(estimate.note);
    } catch (cause) {
      if (cause instanceof EstimateError && cause.aborted) return;
      setError(describeError(cause));
    } finally {
      if (controller.current === next) setBusy(false);
    }
  }

  // Words handed over from search are estimated on open rather than waiting
  // for a click on text already typed. Started from a timer, which the
  // cleanup cancels, so Strict Mode's remount sends one request, not two.
  useEffect(() => {
    if (!initialDescription?.trim()) return;
    const timer = window.setTimeout(() => void run(), 0);
    return () => window.clearTimeout(timer);
    // Once, on open; `run` reads the description state seeded from the prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key: string, change: Partial<ReviewItem>) =>
    setItems((list) => list?.map((item) => (item.key === key ? { ...item, ...change } : item)) ?? null);

  const finalItems = (items ?? []).map(settled);
  const total = totalsOf(finalItems);
  const invalidAmount = (items ?? []).some((item) => {
    const typed = Number(item.quantityText.replace(",", "."));
    return !(Number.isFinite(typed) && typed > 0);
  });

  async function log() {
    if (finalItems.length === 0 || invalidAmount) return;
    setLogging(true);
    try {
      // `confidence` is review-only; the diary entry has no such field.
      let entryItems = finalItems.map((item) => ({
        foodId: item.foodId,
        name: item.name,
        brand: item.brand,
        servingLabel: item.servingLabel,
        servingGrams: item.servingGrams,
        nutrients: item.nutrients,
        source: item.source,
        quantity: item.quantity,
      }));
      if (saveFoods) {
        entryItems = await Promise.all(
          entryItems.map(async (item) => {
            const food = await nutritionApi.createFood({
              name: item.name,
              source: "ai",
              servings: [{ id: "ai", label: item.servingLabel, grams: item.servingGrams, nutrients: item.nutrients }],
            });
            return { ...item, foodId: food.id };
          }),
        );
        void invalidateFoods();
      }
      await create.mutateAsync({ date, meal, items: entryItems });
      toast(`${entryItems.length === 1 ? entryItems[0]!.name : `${entryItems.length} items`} added to ${MEAL_LABELS[meal].toLowerCase()}`);
      onDone();
    } catch (cause) {
      toast(describeError(cause), "error");
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col" onPaste={onPaste}>
      <div className="space-y-4 px-5 pb-5">
        <div className="flex items-start justify-between gap-3">
          <Field label="What did you eat?" className="flex-1">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="2 rotis, a bowl of dal and some rice"
              rows={3}
              data-autofocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
              }}
            />
          </Field>
        </div>

        {image ? (
          <div className="flex items-center gap-3">
            {/* A data URL the page made itself; next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.preview} alt="Meal photo" className="h-20 w-20 rounded-lg border border-line object-cover" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-fg-2">Photo attached</p>
              {provider === "deepseek" ? <p className="mt-0.5 text-xs text-warn">DeepSeek cannot read images. Pick another provider in AI settings, or remove the photo.</p> : null}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setImage(null)}>
              <X size={14} /> Remove
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "press flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors",
              dragging ? "border-volt bg-volt-tint text-volt" : "border-line-strong text-fg-3 hover:border-fg-3/50 hover:text-fg-2",
            )}
          >
            <ImagePlus size={17} />
            Add a photo, drop one here, or paste it
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void takeFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onSettings}>
            <Settings2 size={14} /> AI settings
          </Button>
          <div className="flex gap-2">
            {busy ? (
              <Button variant="ghost" onClick={() => controller.current?.abort()}>
                Stop
              </Button>
            ) : null}
            <Button variant={items ? "secondary" : "primary"} onClick={() => void run()} disabled={busy}>
              <Sparkles size={15} className={busy ? "animate-pulse" : undefined} />
              {busy ? "Estimating" : items ? "Estimate again" : "Estimate"}
            </Button>
          </div>
        </div>

        {error ? <p className="text-sm text-alarm">{error}</p> : null}

        {items ? (
          <section className="space-y-3 border-t border-line pt-4">
            <div>
              <h3 className="text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Review before logging</h3>
              {note ? <p className="mt-1 text-sm text-fg-3">{note}</p> : null}
            </div>
            {items.length === 0 ? <p className="text-sm text-fg-3">Every item was removed.</p> : null}
            {items.map((item) => (
              <ItemCard key={item.key} item={item} customNutrients={customNutrients} onChange={(change) => update(item.key, change)} onRemove={() => setItems((list) => list?.filter((i) => i.key !== item.key) ?? null)} />
            ))}
          </section>
        ) : null}
      </div>

      {items && items.length > 0 ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
          <div className="mr-auto">
            <div className="tabular text-lg leading-none font-semibold text-fg">
              {formatCalories(total.calories)} <span className="text-xs font-normal text-fg-3">kcal</span>
            </div>
            <MacroLine values={total} className="mt-1" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-2 select-none">
            <Checkbox.Root
              checked={saveFoods}
              onCheckedChange={(value) => setSaveFoods(value === true)}
              className="press flex h-4.5 w-4.5 items-center justify-center rounded border border-line-strong bg-surface-2 data-[state=checked]:border-volt data-[state=checked]:bg-volt"
            >
              <Checkbox.Indicator>
                <Check size={12} className="text-volt-ink" strokeWidth={3} />
              </Checkbox.Indicator>
            </Checkbox.Root>
            Save as my foods
          </label>
          <Button variant="primary" onClick={() => void log()} disabled={logging || invalidAmount}>
            <Check size={15} />
            {logging ? "Logging" : `Log ${items.length} ${items.length === 1 ? "item" : "items"} to ${MEAL_LABELS[meal].toLowerCase()}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ItemCard({
  item,
  customNutrients,
  onChange,
  onRemove,
}: {
  item: ReviewItem;
  customNutrients: Parameters<typeof NutrientFields>[0]["customNutrients"];
  onChange: (change: Partial<ReviewItem>) => void;
  onRemove: () => void;
}) {
  const current = settled(item);
  const totals = itemTotals(current);
  const level = confidenceLabel(item.confidence);
  const typed = Number(item.quantityText.replace(",", "."));
  const valid = Number.isFinite(typed) && typed > 0;

  const step = (direction: 1 | -1) => {
    const base = valid ? typed : item.quantity;
    const next = Math.max(0.25, Math.round((base + direction * 0.5) * 4) / 4);
    onChange({ quantityText: formatQuantity(next) });
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <Input value={item.name} onChange={(event) => onChange({ name: event.target.value })} aria-label="Food name" className="h-9 flex-1 font-medium" />
        <Button variant="ghost" size="icon" aria-label={`Remove ${item.name}`} onClick={onRemove}>
          <Trash2 size={15} />
        </Button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge tone={CONFIDENCE_TONES[level]}>{level === "high" ? "High" : level === "medium" ? "Medium" : "Low"} confidence</Badge>
        <span className="text-xs text-fg-3">{item.servingLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="w-8 px-0" aria-label="Less" onClick={() => step(-1)}>
            <Minus size={14} />
          </Button>
          <input
            value={item.quantityText}
            onChange={(event) => onChange({ quantityText: event.target.value.replace(/[^0-9.,]/g, "") })}
            inputMode="decimal"
            aria-label={`Servings of ${item.servingLabel}`}
            className={fieldClass({ className: cn("tabular h-8 w-16 px-2 text-center", !valid && "border-alarm/60") })}
          />
          <Button variant="outline" size="sm" className="w-8 px-0" aria-label="More" onClick={() => step(1)}>
            <Plus size={14} />
          </Button>
          <span className="ml-1 text-xs text-fg-3">servings</span>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="tabular text-sm font-semibold text-fg">
          {formatCalories(totals.calories)} <span className="text-xs font-normal text-fg-3">kcal</span>
        </span>
        <MacroLine values={totals} />
        <button
          type="button"
          onClick={() =>
            // Closing the editor keeps what was typed: the figures become the
            // item's own, rather than snapping back to the model's.
            onChange(item.editing ? { editing: false, nutrients: parseNutrientDraft(item.draft) } : { editing: true, draft: toNutrientDraft(item.nutrients) })
          }
          className="ml-auto text-[13px] font-medium text-volt hover:underline"
        >
          {item.editing ? "Done editing" : "Nutrients"}
        </button>
      </div>
      {item.editing ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-xs text-fg-3">Per one {item.servingLabel}.</p>
          <NutrientFields value={item.draft} onChange={(draft) => onChange({ draft })} customNutrients={customNutrients} defaultOpen />
        </div>
      ) : null}
    </div>
  );
}
