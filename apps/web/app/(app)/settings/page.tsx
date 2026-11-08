"use client";

import {
  ONE_REP_MAX_FORMULAS,
  ONE_REP_MAX_FORMULA_LABELS,
  SEXES,
  SEX_LABELS,
  TRAINING_LEVELS,
  TRAINING_LEVEL_LABELS,
  estimateOneRepMax,
  fromDisplayMeasurement,
  toDisplayMeasurement,
  trimZeros,
  type DistanceUnit,
  type MeasurementUnit,
  type OneRepMaxFormula,
  type Sex,
  type TrainingLevel,
  type WeightUnit,
} from "@lift/shared";
import { LogOut, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import { confirm, toast } from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, Input, Segmented, Select } from "@/components/ui/primitives";
import { signOut } from "@/components/shell/app-shell";
import { useData } from "@/lib/data/store";
import { fullResync, retryRejected, syncNow } from "@/lib/data/sync";
import { formatDateTime } from "@/lib/format";
import { parseDecimal } from "@/lib/measurements/actions";
import { useSettings } from "@/lib/settings";

/**
 * The set the formula picker compares on: eight reps at 100 of anything. At
 * five reps two of the six formulas agree exactly and the comparison shows
 * nothing; at eight all six separate (the phone uses the same reference).
 */
const FORMULA_REFERENCE = { weight: 100, reps: 8 } as const;

function Row({ label, description, children, id }: { label: ReactNode; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex flex-col gap-3 border-t border-line px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description ? <div className="mt-0.5 text-xs text-fg-3">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const update = settings.update;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">Settings</h1>
        <p className="mt-1 text-sm text-fg-2">Preferences for this browser. Your data is stored in kilograms and centimetres, so switching units never changes it.</p>
      </header>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Units" />
          <div className="mt-3">
            <Row label="Weight" description="Sets, volume, records and bodyweight.">
              <Segmented<WeightUnit>
                value={settings.weightUnit}
                onChange={(weightUnit) => update({ weightUnit })}
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lb", label: "lb" },
                ]}
              />
            </Row>
            <Row label="Distance" description="Runs, carries and other distance sets.">
              <Segmented<DistanceUnit>
                value={settings.distanceUnit}
                onChange={(distanceUnit) => update({ distanceUnit })}
                options={[
                  { value: "km", label: "km" },
                  { value: "mi", label: "mi" },
                ]}
              />
            </Row>
            <Row label="Body measurements" description="Tape measurements and your height.">
              <Segmented<MeasurementUnit>
                value={settings.measurementUnit}
                onChange={(measurementUnit) => update({ measurementUnit })}
                options={[
                  { value: "cm", label: "cm" },
                  { value: "in", label: "in" },
                ]}
              />
            </Row>
            <Row label="First day of the week" description="Where weekly totals and the calendar start.">
              <Segmented<"1" | "0">
                value={String(settings.firstDayOfWeek) as "1" | "0"}
                onChange={(value) => update({ firstDayOfWeek: value === "1" ? 1 : 0 })}
                options={[
                  { value: "1", label: "Monday" },
                  { value: "0", label: "Sunday" },
                ]}
              />
            </Row>
          </div>
        </Card>

        <Card>
          <CardHeader title="Calculations" />
          <div className="mt-3">
            <Row
              label="1RM formula"
              description={`Used for every estimated one-rep max. In brackets: what each gives for ${FORMULA_REFERENCE.reps} reps at ${FORMULA_REFERENCE.weight}. They diverge past about 12 reps.`}
            >
              <Select
                className="w-full sm:w-56"
                value={settings.oneRepMaxFormula}
                onChange={(e) => update({ oneRepMaxFormula: e.target.value as OneRepMaxFormula })}
              >
                {ONE_REP_MAX_FORMULAS.map((formula) => (
                  <option key={formula} value={formula}>
                    {ONE_REP_MAX_FORMULA_LABELS[formula]} ({estimateOneRepMax(FORMULA_REFERENCE.weight, FORMULA_REFERENCE.reps, formula).toFixed(1)})
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="Training level" description="Sets the weekly volume ranges (MEV to MRV) each muscle is judged against.">
              <Select
                className="w-full sm:w-56"
                value={settings.trainingLevel}
                onChange={(e) => update({ trainingLevel: e.target.value as TrainingLevel })}
              >
                {TRAINING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {TRAINING_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            </Row>
          </div>
        </Card>

        <Card id="body">
          <CardHeader title="Body" subtitle="Used for BMI, waist-to-height and the body-fat estimate. Kept in this browser only." />
          <div className="mt-3">
            <HeightRow />
            <Row label="Sex" description="The body-fat estimate uses a different formula for each.">
              <Select
                className="w-full sm:w-56"
                value={settings.sex ?? ""}
                onChange={(e) => update({ sex: (e.target.value || null) as Sex | null })}
              >
                <option value="">Not set</option>
                {SEXES.map((sex) => (
                  <option key={sex} value={sex}>
                    {SEX_LABELS[sex]}
                  </option>
                ))}
              </Select>
            </Row>
          </div>
        </Card>

        <SyncCard />
        <AccountCard />

        <p className="px-1 pb-4 text-xs leading-relaxed text-fg-3">
          Workouts are logged in the Lift app on your phone. This web app is for your statistics, exercise library, routines
          and body measurements, and everything you change here syncs back to the phone.
        </p>
      </div>
    </div>
  );
}

function HeightRow() {
  const heightCm = useSettings((s) => s.heightCm);
  const unit = useSettings((s) => s.measurementUnit);
  const update = useSettings((s) => s.update);
  const shown = heightCm == null ? "" : trimZeros(toDisplayMeasurement(heightCm, unit).toFixed(1));
  const [draft, setDraft] = useState<string | null>(null);

  const value = draft ?? shown;
  const parsed = parseDecimal(value);
  const cm = parsed === null ? null : fromDisplayMeasurement(parsed, unit);
  const invalid = value.trim() !== "" && (cm === null || cm < 100 || cm > 250);

  function commit() {
    if (draft === null) return;
    if (draft.trim() === "") update({ heightCm: null });
    else if (!invalid && cm !== null) update({ heightCm: Math.round(cm * 10) / 10 });
    setDraft(null);
  }

  return (
    <Row label="Height" description={invalid ? <span className="text-alarm">Enter a height between {unit === "cm" ? "100 and 250 cm" : "39 and 98 in"}.</span> : "Leave empty to hide the figures that need it."}>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Height"
          inputMode="decimal"
          className="tabular w-28 text-right"
          value={value}
          placeholder={unit === "cm" ? "180" : "71"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="w-6 text-sm text-fg-3">{unit}</span>
      </div>
    </Row>
  );
}

function SyncCard() {
  const syncing = useData((s) => s.syncing);
  const lastSyncedAt = useData((s) => s.lastSyncedAt);
  const syncError = useData((s) => s.syncError);
  const pending = useData((s) => s.pending);
  const rejected = useData((s) => s.rejected);
  const [resyncing, setResyncing] = useState(false);

  async function resync() {
    const ok = await confirm({
      title: "Download everything again?",
      body: "This throws away the copy of your log stored in this browser and downloads it from the server. Changes not yet uploaded are kept and sent first.",
      confirmLabel: "Download again",
    });
    if (!ok) return;
    setResyncing(true);
    try {
      await fullResync();
      toast("Your log has been downloaded again");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Sync"
        subtitle="Changes upload within a second and the log refreshes every minute while this tab is open."
        action={
          <Button size="sm" onClick={() => void syncNow()} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} /> Sync now
          </Button>
        }
      />
      <div className="mt-3">
        <Row label="Last synced" description={syncError ? <span className="text-alarm">{syncError}</span> : undefined}>
          <span className="tabular text-sm text-fg-2">{syncing ? "Syncing…" : lastSyncedAt ? formatDateTime(lastSyncedAt) : "Not yet"}</span>
        </Row>
        <Row label="Waiting to upload" description="Changes made here that the server has not confirmed yet.">
          <span className="tabular text-sm text-fg-2">{pending}</span>
        </Row>
        {rejected.count > 0 ? (
          <Row
            label={
              <span className="inline-flex items-center gap-2">
                Refused by the server <Badge tone="alarm">{rejected.count}</Badge>
              </span>
            }
            description={rejected.reason ?? undefined}
          >
            <Button size="sm" variant="outline" onClick={() => void retryRejected()}>
              Retry
            </Button>
          </Row>
        ) : null}
        <Row label="Download everything again" description="For when something here looks different from your phone.">
          <Button size="sm" variant="outline" onClick={() => void resync()} disabled={resyncing || syncing}>
            {resyncing ? "Downloading…" : "Download again"}
          </Button>
        </Row>
      </div>
    </Card>
  );
}

function AccountCard() {
  const user = useData((s) => s.user);
  return (
    <Card>
      <CardHeader title="Account" />
      <div className="mt-3">
        <Row label={user?.name || "Signed in"} description={user?.email}>
          <Button size="sm" variant="danger" onClick={() => void signOut()}>
            <LogOut size={14} /> Sign out
          </Button>
        </Row>
      </div>
    </Card>
  );
}
