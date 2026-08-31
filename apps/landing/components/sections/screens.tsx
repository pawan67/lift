import {
  AnnotatedPhone,
  type Callout,
} from "@/components/site/annotated-phone";
import { KineticHeading } from "@/components/site/kinetic";
import { Phone } from "@/components/site/phone";
import { Reveal } from "@/components/site/reveal";
import { screens, type Screen } from "@/lib/screens";
import { cn } from "@/lib/utils";

/*
 * A kinetic title, one annotated device down the middle of the measure, a band
 * of text, then two rows, and no two of them the same shape.
 *
 * The device used to sit in a column beside the section's own headline, which
 * was the fix for a real problem: a 730px-tall phone next to two hundred pixels
 * of copy leaves a quarter of a screen of nothing above and below the text. The
 * title now solves it a better way. Set across the whole measure, with its two
 * words pulled to opposite gutters, it fills that space with the thing the
 * section is actually called, and the device drops below it into the middle of
 * the page where there is room either side of it for the callouts to name what
 * is on the glass.
 *
 * That is the point of moving it. A logging screen at 300px is grey lines to
 * anybody who does not already use the app, and this section is the one making
 * the claim that the app is legible mid set. Four hairlines with a label each
 * is the screen explaining itself instead of the paragraph beside it doing the
 * explaining.
 *
 * The band under it is the rest timer, and it has no device because there is no
 * screenshot of one in `screenshots/`: the timer is a sheet over a running
 * session rather than a screen the capture script can navigate to. Setting it as
 * two columns of text rather than faking a device is the honest version, and it
 * breaks up the alternation below, which is a fine rhythm and a fatal pattern.
 *
 * Two repeated devices came out of every row rather than went in: a mono
 * caption that restated the screen's own title, and a lime-dot footnote under
 * all four. Fine once. Four times down a column they stop being detail and
 * become wallpaper, which is most of what makes a page read as assembled rather
 * than written.
 */
interface Feature {
  screen: Screen;
  title: string;
  body: string;
}

const OPENING: Feature = {
  screen: screens.activeWorkout,
  title: "The set is the unit of work.",
  body: "Weight, reps, done, and last session's numbers on the same row so you know what you are chasing. Checking a set off starts the rest timer and moves nothing else on the screen. Nothing happens between the rep and the record.",
};

/*
 * The four heights are measured off `screenshots/session.png` rather than
 * spaced evenly down the frame: each rule has to arrive at the thing its label
 * names, and the gaps between them are whatever the screen makes them. They are
 * percentages rather than pixels so that they survive the frame changing size,
 * which it has once already. **Retaking the screenshots means re-measuring
 * them**, the same way the alt text has to be re-read, and it has already
 * caught one set out: the session screen grew an RPE column and a warm-up
 * button, every row moved down, and four rules went on pointing at where the
 * rows used to be.
 *
 * They are the screen fraction converted, not the screen fraction. A callout is
 * positioned against the whole device, and the glass starts 1.218% down it and
 * runs for 97.321% of it, so a row at fraction `f` of the screenshot sits at
 * `1.218 + f * 97.321` percent of the frame.
 *
 * The sides are not decorative either. `PREVIOUS` is the left-hand column of a
 * set row and `KG`, `REPS` and the tick are the right-hand ones, so a label
 * about last session comes in from the left and a label about what you are
 * entering comes in from the right. A rule that crosses the screen to reach
 * its subject is pointing at the wrong half of it.
 */
const LOGGING: Callout[] = [
  { label: "Elapsed, and sets done", top: "12.5%", side: "left" },
  { label: "Weight, reps, RPE", top: "26.8%", side: "right" },
  { label: "Last session, same row", top: "42.1%", side: "left" },
  { label: "Checking off starts rest", top: "61.6%", side: "right" },
];

const TIMER = {
  title: "Rest is a deadline, not a stopwatch.",
  body: "The countdown carries on in your notification shade whether or not the app is open, and it stays right even if you swipe the app away.",
};

const FEATURES: Feature[] = [
  {
    screen: screens.statistics,
    title: "Where the volume actually went.",
    body: "Weekly sets per muscle, drawn on the figure instead of listed in a table, shaded against the range each one actually grows in. Warm-up sets are left out, because counting them would inflate every number on the screen.",
  },
  {
    screen: screens.calendar,
    title: "Every session you have logged.",
    body: "Months shaded day by day against your own typical session, and personal records marked where they happened. It is the same log you were just writing to, so there is nothing to refresh.",
  },
];

/* No `home` here: it is the hero's device, and the rail is what the tour has
   not shown yet. */
const RAIL: Screen[] = [
  screens.workout,
  screens.history,
  screens.body,
  screens.profile,
];

/*
 * `overflow-x-clip` on the section, and it is load-bearing. The `screen-cast`
 * glow below is an absolutely positioned box inset by -35% of the device's
 * width, which at every viewport under 1920 put its right edge past the
 * document: 97px of sideways scroll on a 375pt phone, 214px at 768. A
 * decorative gradient was widening the page and taking the whole layout with
 * it.
 *
 * `clip` rather than `hidden` because hidden on one axis forces the other to
 * scroll, and this section is tall enough that a nested scroll container is a
 * real hazard. The hero clips the same glow with its own `overflow-hidden`,
 * which is why only this one ever escaped.
 */
export function Screens() {
  /*
   * `step`, and one of the four sections that still opens on a kinetic
   * title. This is the tour, and the tour is what the page is for.
   */
  return (
    <section id="screens" className="overflow-x-clip pt-step">
      <div className="shell">
        <KineticHeading
          top="Built for"
          bottom="mid set"
          ledeMotion="ink"
          lede="Every screen below is the app itself, with a year of training behind it: 182 sessions, 1,683,925 kg. Not one of them is a mockup."
        />

        {/* The one screen glow on the page, and it lives inside
            `AnnotatedPhone`. Applied to all the devices it stopped reading as
            light and started reading as a filter. */}
        <div className="mt-16 sm:mt-20">
          <AnnotatedPhone
            screen={OPENING.screen}
            callouts={LOGGING}
            size="lg"
            sizes="(max-width: 1024px) 60vw, 336px"
          />
        </div>

        {/*
          The opening feature reads as the caption to the device above it, so it
          is set under it on one rule rather than beside it in a column.
        */}
        <Reveal
          as="article"
          className="mt-20 border-t border-line pt-12 sm:mt-24 sm:pt-14"
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-12 lg:gap-20">
            <h3 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)] text-balance">
              {OPENING.title}
            </h3>
            <p className="max-w-[54ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
              {OPENING.body}
            </p>
          </div>
        </Reveal>

        {/*
          Heading left, body right, both on one rule. The only row in the
          section that is text the whole way across, which is what stops the two
          device rows under it from reading as a template.
        */}
        <Reveal
          as="article"
          className="mt-14 border-t border-line pt-12 sm:mt-16 sm:pt-14"
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-12 lg:gap-20">
            <h3 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)] text-balance">
              {TIMER.title}
            </h3>
            <p className="max-w-[54ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">{TIMER.body}</p>
          </div>
        </Reveal>

        <div className="mt-24 space-y-24 sm:mt-28 sm:space-y-28">
          {FEATURES.map((feature, i) => (
            <Reveal
              as="article"
              key={feature.title}
              className={cn(
                "grid items-center gap-10 md:gap-12 lg:gap-16",
                /*
                  The device gets a track exactly its own width and the copy
                  gets everything left, at every size from `md` up. There used
                  to be an even split at `lg` on the grounds that a 1280 measure
                  had room for one; a 940 one does not. Halved, a 240px phone
                  sits in a 390px column and the paragraph beside it is 36ch,
                  which is a newspaper column rather than a paragraph. Sized to
                  the device it is 48ch and the phone stops floating in a third
                  of a metre of its own black.
                */
                i % 2 === 1
                  ? "md:grid-cols-[minmax(0,1fr)_auto]"
                  : "md:grid-cols-[auto_minmax(0,1fr)]",
              )}
            >
              {/*
                The device is pushed toward the copy rather than centred in its
                half. Centred, a 250px phone in a 600px column leaves 175px of
                nothing on the inside edge and the pair stops reading as one
                thing.
              */}
              <div
                className={cn(
                  "relative flex items-center justify-center",
                  i % 2 === 1
                    ? "md:order-2 lg:justify-start"
                    : "lg:justify-end",
                )}
              >
                <Phone
                  screen={feature.screen}
                  size="md"
                  sizes="(max-width: 1024px) 40vw, 248px"
                />
              </div>

              <div className={cn(i % 2 === 1 && "md:order-1")}>
                <h3 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)] text-balance">
                  {feature.title}
                </h3>
                <p className="mt-5 max-w-[54ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
                  {feature.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-24 sm:mt-28">
          <p className="max-w-[46ch] text-fg-3">
            The rest of it: routines, history, bodyweight and measurements.
          </p>

          {/*
            `scroll-pl-*` has to match `px-*`, and leaving it out is not a
            cosmetic miss. A snap container's snapport starts at its padding
            box, so `snap-start` on the first item scrolls the rail right by
            exactly the padding: the leading phone and its caption end up flush
            against the screen edge with the gutter eaten.
          */}
          <ul
            data-stagger
            className="rail mt-8 -mx-5 flex snap-x snap-mandatory scroll-pl-5 gap-5 overflow-x-auto px-5 pb-5 sm:-mx-8 sm:scroll-pl-8 sm:px-8 lg:-mx-12 lg:scroll-pl-12 lg:px-12"
          >
            {RAIL.map((screen) => (
              <li key={screen.caption} className="snap-start">
                <Phone screen={screen} size="sm" sizes="152px" />
                <p className="mt-3 text-sm text-fg-3">{screen.caption}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
