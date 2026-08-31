import { Reveal } from "@/components/site/reveal";
import { cn } from "@/lib/utils";

/*
 * The page's quieter section opening, and the reason there are two of them.
 *
 * Every section here used to open on a `KineticHeading`: two words, uppercase,
 * the second pulled to the opposite gutter, a lime full stop, and a lede
 * stacked underneath. Nine times. The objection is the one
 * `components/sections/screens.tsx` already makes about the four repeated
 * captions it deleted, and it lands harder here, because a section title is
 * the thing a reader uses to work out where they are: *"Fine once. Four times
 * down a column they stop being detail and become wallpaper."* By the sixth
 * identical 108px title the effect had stopped announcing a section and become
 * the noise between sections, and the page read as nine slots with the same
 * component dropped into each.
 *
 * So the kinetic setting is now rationed to the four sections that are load
 * bearing, `screens`, `offline`, `privacy` and `self-host`, which are the tour
 * and the three claims the page exists to make. Everything else opens on this.
 *
 * It is a different register rather than a smaller version of the same one,
 * which is the whole point: a chapter opens on a rule and a sentence, a pillar
 * opens on two words the width of the screen. Set the two side by side and
 * nobody has to be told which is which.
 *
 * Nothing here is invented vocabulary. The rule above the heading is the same
 * `border-t border-line` the feature rows in `screens.tsx` and the two halves
 * in `portable.tsx` already open on, and the two-track split of heading against
 * body is the grid those rows use. This is the page's existing furniture
 * arranged as a heading, not a second design system.
 *
 * **The motion is `Reveal` and there is no scrubbed effect here.** That is a
 * decision rather than an omission. The kinetic titles are expensive on
 * purpose and their cost is what makes them read as arrivals; giving the
 * chapters a scroll effect of their own would put the two registers back on
 * the same footing and undo the thing this component exists to do.
 */
export function ChapterHeading({
  label,
  title,
  lede,
  stop = true,
  className,
}: {
  /** A mono standfirst over the rule. Used once, and it should stay rare. */
  label?: string;
  title: string;
  lede?: string;
  /** The volt full stop. Off when the title already ends in punctuation. */
  stop?: boolean;
  className?: string;
}) {
  return (
    <Reveal className={cn("border-t border-line pt-8 sm:pt-10", className)}>
      {label ? <p className="label mb-6 text-fg-3">{label}</p> : null}

      {/*
        Heading left, lede right, on one rule, and one column until `md`.

        The lede sits beside the title rather than under it because that is the
        other half of the contrast with the kinetic setting: a pillar stacks and
        takes a screen, a chapter is one horizontal band you take in at once.
        The 1.15fr on the body track is the ratio the feature rows in
        `screens.tsx` already use, so a chapter and the rows under it share an
        axis instead of each finding their own.
      */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-12 lg:gap-20">
        {/*
          A third the size of a kinetic title and a third larger than the `h3`s
          inside the section, which is the ordering that was missing when every
          section opened at 108px: the titles were four times the size of their
          own subheadings and there was nothing in between.
        */}
        <h2 className="display-tight text-[clamp(2rem,4.4vw,3.25rem)] text-balance">
          {title}
          {stop ? <span className="text-volt">.</span> : null}
        </h2>

        {lede ? (
          <p className="max-w-[54ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
            {lede}
          </p>
        ) : null}
      </div>
    </Reveal>
  );
}
