"use client";

/**
 * Templates: named groups of foods logged together in one click.
 *
 * Most used first (the server orders them by how often each was logged), each
 * with its total and what is in it, so the right one can be picked without
 * opening it. Log puts it into today at the meal it is usually eaten at, or
 * Snacks when it has none; the menu logs it into any other meal.
 */

import { MEALS, MEAL_LABELS, formatCalories, totalsOf, type MealTemplate } from "@lift/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { TemplateDialog } from "@/components/food/template-dialog";
import { MacroLine } from "@/components/food/summary";
import { confirm } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActionMenu } from "@/components/ui/dropdown-menu";
import { EmptyState, Skeleton } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { describeError, nutritionApi } from "@/lib/nutrition/api";
import { todayIso } from "@/lib/nutrition/dates";
import { nutritionKeys, useLogTemplate, useTemplates } from "@/lib/nutrition/queries";

export default function TemplatesPage() {
  const client = useQueryClient();
  const templates = useTemplates();
  const logTemplate = useLogTemplate();
  // `null` is a new template; undefined is closed.
  const [editing, setEditing] = useState<MealTemplate | null | undefined>(undefined);

  async function log(template: MealTemplate, meal = template.meal ?? "snacks") {
    try {
      await logTemplate.mutateAsync({ id: template.id, input: { date: todayIso(), meal } });
      toast(`${template.name} added to today's ${MEAL_LABELS[meal].toLowerCase()}`);
    } catch (failure) {
      toast(describeError(failure), "error");
    }
  }

  async function remove(template: MealTemplate) {
    const ok = await confirm({
      title: `Delete ${template.name}?`,
      body: "The template goes. Anything already logged from it stays in your diary.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await nutritionApi.deleteTemplate(template.id);
      await client.invalidateQueries({ queryKey: nutritionKeys.templates });
      toast(`${template.name} deleted`);
    } catch (failure) {
      toast(describeError(failure), "error");
    }
  }

  const newButton = (
    <Button variant="primary" onClick={() => setEditing(null)}>
      <Plus size={16} /> New template
    </Button>
  );

  return (
    <>
      <PageHeader title="Templates" subtitle="Foods you eat together, logged in one click." back={{ href: "/food", label: "Food" }} actions={newButton} />

      {templates.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : templates.isError ? (
        <Card>
          <EmptyState
            title="Could not load your templates"
            body={describeError(templates.error)}
            action={
              <Button onClick={() => void templates.refetch()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : templates.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers size={22} />}
            title="No templates yet"
            body="Open a meal's menu in the food diary and choose Save as template, or build one here from scratch. Then it logs in one click."
            action={newButton}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.data.map((template) => {
            const totals = totalsOf(template.items);
            return (
              <Card key={template.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => setEditing(template)} className="min-w-0 flex-1 text-left">
                    <h2 className="truncate text-base font-semibold tracking-tight text-fg hover:underline hover:decoration-line-strong hover:underline-offset-4">
                      {template.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                      {template.meal ? <Badge>{MEAL_LABELS[template.meal]}</Badge> : null}
                      <span>
                        {template.items.length} {template.items.length === 1 ? "food" : "foods"}
                      </span>
                      {template.useCount > 0 ? <span>· logged {template.useCount}×</span> : null}
                    </div>
                  </button>
                  <Button variant="primary" size="sm" onClick={() => void log(template)} disabled={logTemplate.isPending}>
                    <Plus size={14} /> Log
                  </Button>
                  <ActionMenu
                    label={`${template.name} actions`}
                    items={[
                      ...MEALS.map((meal) => ({ label: `Log to ${MEAL_LABELS[meal]}`, onSelect: () => void log(template, meal) })),
                      null,
                      { label: "Edit", icon: <Pencil size={15} />, onSelect: () => setEditing(template) },
                      { label: "Delete", icon: <Trash2 size={15} />, destructive: true, onSelect: () => void remove(template) },
                    ]}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="flex items-baseline gap-1">
                    <span className="tabular text-xl font-semibold tracking-[-0.02em] text-fg">{formatCalories(totals.calories)}</span>
                    <span className="text-xs text-fg-3">kcal</span>
                  </span>
                  <MacroLine values={totals} />
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] text-fg-3">{template.items.map((item) => item.name).join(", ")}</p>
              </Card>
            );
          })}
        </div>
      )}

      <TemplateDialog open={editing !== undefined} onClose={() => setEditing(undefined)} template={editing ?? null} />
    </>
  );
}
