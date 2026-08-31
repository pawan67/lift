import Image, { type StaticImageData } from "next/image";

import alarmArt from "@/assets/details/alarm.png";
import platesArt from "@/assets/details/plates.png";
import recordsArt from "@/assets/details/records.png";
import restTimerArt from "@/assets/details/rest-timer.png";
import supersetArt from "@/assets/details/superset.png";
import widgetsArt from "@/assets/details/widgets.png";
import { ChapterHeading } from "@/components/site/chapter";
import { cn } from "@/lib/utils";

/*
 * Six features that never make a feature list, drawn rather than described.
 *
 * This is the one card grid on the page, and `offline.tsx` carries the argument
 * against having one: six equal cells of number, heading and paragraph is the
 * most recognisable shape on the internet and reads as a filled-in template.
 * That objection is about *text* in cells. These cells are not text. Each one
 * leads with a picture of the thing it is claiming, and the claim is only
 * legible because the picture is there first: "the timer outlives the app" is a
 * sentence you either believe or do not, and a countdown sitting in a
 * notification shade is the evidence for it.
 *
 * So the tiles are unequal on purpose. The dial gets two rows because it is the
 * one piece of art with a number in it big enough to read across a room, and
 * the rest are sized to what their picture needs rather than to a grid that
 * wanted filling.
 *
 * **The artwork is generated, not photographed.** Every tile is a vector
 * drawing built against the palette in `app/globals.css`, in the Figma file at
 * figma.com/design/Zou12Kt4iOiqjJe9J0dk0Q, exported at 2x. The six PNGs are
 * transparent and carry only the ink: the card supplies the ground and the
 * border, so `--surface` is named in exactly one place and a change to it does
 * not strand six files at the old colour.
 *
 * **That transparency is load-bearing and easy to lose.** A Figma export
 * flattens anything sitting behind the artboard, so a backdrop left on the
 * canvas ships as an opaque `#000000` rectangle. On a `--surface` card that is
 * a black tile inside a lighter box with a visible seam all the way round it,
 * which is precisely what the first export did. If a re-export ever looks like
 * a rectangle, that is what happened; check the alpha before checking anything
 * else.
 *
 * The maintenance cost that is left: a palette change means redrawing six
 * files, where the screenshots elsewhere on this page re-take themselves from
 * the app. The trade is deliberate. None of these six has a screen worth
 * photographing at 270px, which is exactly why they were being left off the
 * page.
 *
 * The headings and the copy are live text, never baked into the image. A
 * marketing tile with its sentence flattened into a PNG cannot be read by a
 * screen reader, cannot be selected, and cannot re-wrap on a phone, and this
 * page reflows to 350px.
 */
interface Detail {
  art: StaticImageData;
  alt: string;
  title: string;
  body: string;
  /** Where the tile sits in the six-column grid, above `lg`. */
  span: string;
}

const DETAILS: Detail[] = [
  {
    art: restTimerArt,
    alt: "A rest timer at one minute thirty with most of its dial spent, and the same countdown running in an Android notification underneath it",
    title: "The timer outlives the app.",
    body: "The countdown is an Android foreground service, not a number the app is holding. Force-quit mid set and it keeps running in the notification shade.",
    span: "lg:col-span-2 lg:row-span-2",
  },
  {
    art: supersetArt,
    alt: "Chest press and triceps rope pushdown, tied by a lime line down their left edge, each carrying a link chip marked A",
    title: "Two exercises, one link.",
    body: "Tap the link chip to join an exercise to the one above or below it. Set the pairing in a routine and it carries into every session started from that routine.",
    span: "lg:col-span-4",
  },
  {
    art: platesArt,
    alt: "A barbell loaded on both sides with a twenty-five, a fifteen and a ten kilogram plate",
    title: "What actually goes on the bar.",
    body: "Give it the weight you want and the bar you have. It answers in plates, per side.",
    span: "lg:col-span-2",
  },
  {
    art: widgetsArt,
    alt: "Two home screen widgets: three routines each with a start button, and a bodyweight of 83.7 kilograms with a button to log the next one",
    title: "Two widgets, no app to open.",
    body: "Your routines, one tap from starting. Your last weigh-in, one tap from the next. Both follow whichever palette the app is on.",
    span: "lg:col-span-2",
  },
  {
    art: alarmArt,
    alt: "A bell, and three choices for what it rings on: media, notification and alarm, with alarm selected",
    title: "A bell you can actually hear.",
    body: "A rest bell on the media volume goes wherever your music goes, which is the earbuds sitting on the bench. This one can ring on the notification or the alarm stream instead, and silent mode leaves the alarm stream alone.",
    span: "lg:col-span-3",
  },
  {
    art: recordsArt,
    alt: "An estimated one rep max of 142.5 kilograms for the bench press, over ten sessions rising to a new personal record",
    title: "Bests you never have to type.",
    body: "Every exercise carries an estimated one rep max worked out from your own sets, and a record for each kind of best. Warm-ups count towards none of it.",
    span: "lg:col-span-3",
  },
];

export function Details() {
  /*
   * `close`, because the hero hands straight to this and the two are one
   * movement: the first screen of the app, then six things about it.
   */
  return (
    <section id="details" className="overflow-x-clip pt-close">
      <div className="shell">
        <ChapterHeading
          title="The small stuff"
          lede="None of these sells an app on its own. They are the six that decide whether one survives contact with a gym: a timer that outlives being force-quit, a bell that reaches you, and a bar you do not have to do arithmetic on."
        />

        {/*
          `data-stagger` animates the direct children of this element, so the
          tiles have to be those children. A wrapper around any of them takes it
          out of the run.

          One column on a phone, two in between, and the six-column arrangement
          only at `lg`, where the measure is wide enough for a two-column tile
          to still be 270px of picture. Below that every span collapses and the
          grid reads top to bottom in the order above.
        */}
        <div
          data-stagger
          className="mt-14 grid gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-6"
        >
          {DETAILS.map((detail) => (
            <article
              key={detail.title}
              className={cn(
                "flex flex-col overflow-hidden rounded-3xl border border-line bg-surface",
                detail.span,
              )}
            >
              {/*
                `grow` on the picture rather than on the copy. The dial tile is
                two rows tall and the others are one, so something has to absorb
                the difference, and it should be the black around the artwork
                rather than a paragraph stretched away from its own heading.
              */}
              <div className="flex grow items-center justify-center">
                <Image
                  src={detail.art}
                  alt={detail.alt}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="h-auto w-full"
                />
              </div>

              <div className="px-6 pb-7 sm:px-7 sm:pb-8">
                <h3 className="display-tight text-[1.375rem] sm:text-[1.5rem]">
                  {detail.title}
                </h3>
                <p className="mt-2.5 max-w-[42ch] text-[0.9375rem] leading-[1.6] text-fg-2">
                  {detail.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
