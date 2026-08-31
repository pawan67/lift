import { ChapterHeading } from "@/components/site/chapter";
import { Reveal } from "@/components/site/reveal";

/*
 * The two parts of the app that say something rather than record something,
 * and the one section on the page with no device in it.
 *
 * Deliberate on both counts: these are the newest features and there are no
 * screenshots of them yet, and a fifth phone-beside-paragraph in a row is where
 * a tour turns into a template.
 *
 * The two halves are also drawn differently on purpose. The left one is a
 * bordered panel because it is quoting a control out of the app, and that is
 * the only borrowed interface on the page. The right one is bare text on the
 * canvas, hanging indents and all, because it is quoting a *document*. Giving
 * them the same card would have said they were the same kind of thing.
 *
 * Neither is invented: `writeReason` in `packages/shared/src/progression.ts`
 * produces exactly those four sentences, and the outline is the heading
 * sequence `packages/shared/src/coach.ts` writes.
 */
const SUGGESTIONS = [
  {
    kind: "Add weight",
    tone: "text-volt",
    target: "82.5 kg × 5",
    reason: "Cleared 8 reps on every set",
  },
  {
    kind: "Add reps",
    tone: "text-signal",
    target: "80 kg × 7",
    reason: "Two of three sets cleared 8",
  },
  {
    kind: "Hold",
    tone: "text-fg-3",
    target: "80 kg × 6",
    reason: "Short of 5 reps, repeat this weight",
  },
  {
    kind: "Back off",
    tone: "text-warn",
    target: "72.5 kg × 5",
    reason: "Short of 5 reps for three sessions, take 10% off",
  },
];

const OUTLINE = [
  { heading: "About me", note: "and anything you want to add" },
  { heading: "The window", note: "how far back it looked" },
  { heading: "Weekly sets per muscle", note: "against where growth starts" },
  { heading: "Session log", note: "every set, with dates" },
  { heading: "Routines", note: "so it can suggest edits" },
  { heading: "Current personal bests", note: null },
];

export function Opinion() {
  /*
   * `turn`. Everything above this section is the app writing things down and
   * everything in it is the app reading them back, which is the largest
   * change of subject on the page and the first of the three that get one.
   */
  return (
    <section id="coach" className="overflow-x-clip pt-turn">
      <div className="shell">
        {/*
          The one standfirst on the page, and the only `label` any chapter
          takes. It is dated rather than argued, so it sits on the rule with
          the section's title rather than inside its lede, where a reader
          would have to get past it to reach the argument.
        */}
        <ChapterHeading
          label="New in this release"
          /* Not "Two parts that read back": the heading track is 355px at the
             measure and every other chapter title sets to two lines in it, so
             the extra word tipped this one to three and broke the run. */
          title="Two parts read back"
          lede="Most of the app writes down what you did. These two read it back: one works out the next set from your own history, the other hands the whole log to whichever model you already talk to."
        />

        {/*
          Stacked, not side by side. They were two tracks, which said the right
          thing about them: these are two halves of one idea and they belong on
          one row. Against a 940 measure that row is 382px a side, and neither
          half survives it. The suggestion table is four rows of a label, a
          target and a reason, and at 382 the reason wraps under the target on
          every one of them; the document outline hangs its glosses off the
          heading beside them, and at 382 nothing has room to hang.

          The pairing is still made, by the gap and by the two headings. It is
          just made down the page rather than across it.
        */}
        <div className="mt-14 grid gap-20 sm:mt-16 sm:gap-24">
          <Reveal>
            <h3 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)]">
              What to lift next.
            </h3>
            <p className="mt-5 max-w-[52ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
              Every exercise carries the weight and the reps to beat, worked out
              from your own last few sessions rather than from a program. Tap
              the line to fill the set, or ignore it and nothing happens.
            </p>

            <div className="mt-9 max-w-[46rem] overflow-hidden rounded-xl border border-line bg-surface">
              <ul className="divide-y divide-line">
                {SUGGESTIONS.map((row) => (
                  <li
                    key={row.kind}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 px-5 py-4"
                  >
                    <span className={`label w-24 shrink-0 ${row.tone}`}>
                      {row.kind}
                    </span>
                    <span className="figure text-[0.9375rem] font-medium text-fg">
                      {row.target}
                    </span>
                    {/*
                      Below `sm` the reason takes its own line at full width
                      instead of being pushed right by `ml-auto`, where wrapped
                      and right-aligned it reads as a caption belonging to the
                      row underneath it.
                    */}
                    <span className="basis-full pl-28 text-[0.8125rem] text-fg-3 sm:ml-auto sm:basis-auto sm:pl-0">
                      {row.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <h3 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)] text-balance">
              A second opinion, from whatever model you already use.
            </h3>
            <p className="mt-5 max-w-[52ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
              Lift writes your training out as one document: the sessions as you
              did them, the weekly sets each muscle got, and the routines
              behind all of it. Hand the file to ChatGPT or Claude and read
              what comes back. The app sends nothing anywhere. You share the
              file.
            </p>

            {/*
              A document, set as one: a filename, a rule, and headings on a
              hanging indent. No panel, because the thing it is quoting is not
              part of the interface.
            */}
            <figure className="mt-9 max-w-[46rem]">
              <figcaption className="figure border-b border-line pb-3 text-[0.8125rem] text-fg-3">
                training-review.md
              </figcaption>
              <ul className="mt-5 space-y-3">
                {OUTLINE.map((row) => (
                  <li key={row.heading} className="flex gap-3">
                    <span className="figure shrink-0 pt-0.5 text-[0.8125rem] text-volt/60">
                      ##
                    </span>
                    <span className="text-[1.0625rem] text-fg">
                      {row.heading}
                      {row.note ? (
                        <span className="block text-[0.9375rem] text-fg-3 sm:ml-3 sm:inline">
                          {row.note}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
