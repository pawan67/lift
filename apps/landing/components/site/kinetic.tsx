import { cn } from "@/lib/utils";

/*
 * The page's display headings, and the one place its motion is spent.
 *
 * **This is the loud one of two, and it is rationed to four sections.** It ran
 * on all nine once, which is what made a page of deliberate sections read as a
 * page of slots: nine 108px titles at nine identical intervals stop announcing
 * anything, because a signal every reader sees nine times is not a signal.
 * `components/site/chapter.tsx` is the quiet setting the other five use, and
 * the note at the top of it carries the rest of the argument. The four kept
 * here are `screens`, `offline`, `privacy` and `self-host`: the tour, and the
 * three claims the page exists to make.
 *
 * A section opens on two words arriving from opposite sides as you scroll into
 * them. The pull in opposite directions is the whole effect: two lines sliding
 * the same way is a block of type settling, two lines closing on each other
 * from the gutters is a thing being assembled in front of you.
 *
 * They start off the screen rather than a little way in from it. The first
 * version travelled 13% of its own width, which is a nudge: enough to notice
 * something moved, not enough to read as arrival. Parked a whole viewport out
 * they have somewhere to come from, and the section each one sits in is
 * `overflow-x-clip` so the parked line is cut off rather than turned into a
 * document that scrolls sideways.
 *
 * The type rests inside the measure rather than running to the window. That is
 * a change from the first version of this, which was full bleed: against a
 * 940px column a heading pinned to the viewport gutters reads as having come
 * loose from the section under it. What the effect needed was never the width,
 * it was the distance, and the distance lives in `scroll-motion.tsx` now.
 *
 * The second line is right-aligned rather than indented by a percentage. An
 * indent is a guess about how far a word should hang off the one above it and
 * it has to be tuned per heading; aligning to the opposite gutter is the same
 * idea with the arithmetic taken out, and it says the thing the animation is
 * about, which is that these two came from opposite edges.
 *
 * Nothing in this file animates. Every element is static markup carrying a
 * `data-kinetic-*` hook, and the hooks are picked up once by
 * `components/site/scroll-motion.tsx`, which is also where the whole system is
 * switched off for `prefers-reduced-motion`. There is no client component and
 * no state here: this renders on the server, ships nothing, and renders in the
 * finished state, so a reader whose JavaScript never arrives gets the heading
 * rather than a gap where one was going to be.
 */

const LEDE =
  "mt-7 max-w-[46ch] text-[1.0625rem] leading-[1.6] text-fg-2 sm:mt-9 sm:text-xl sm:leading-[1.55]";

export function KineticHeading({
  top,
  bottom,
  lede,
  ledeMotion = "rise",
  stop = true,
  size = "lg",
  className,
}: {
  top: string;
  bottom: string;
  lede?: string;
  /*
   * `ink` is the word-by-word fill, and the two are exclusive rather than
   * stackable. Run together, the block's own fade and each word's fade
   * multiply, so the first word of a paragraph that is itself at 40% opacity
   * resolves to 6% and the sentence starts as a smudge.
   */
  ledeMotion?: "rise" | "ink";
  /** The volt full stop. Off when the second line already ends in punctuation. */
  stop?: boolean;
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div data-kinetic className={cn("relative", className)}>
      <h2
        className={cn(
          /*
           * `display-caps` restores the tighter track and leading that
           * `.display` carried before the hero was opened up. It is not a
           * preference: these lines are `nowrap` and the tracking is what
           * decides whether the longest of them fits the measure. See the note
           * in `app/globals.css`.
           */
          "display display-caps uppercase",
          /*
           * 12vw, up from 6.5, and the minimum is the part that matters. This
           * page is read on a phone first now: at the old clamp a 390pt screen
           * got 36px, which is a heading, and what it wanted was a title. At
           * 12vw it gets 47px across a 350px measure, which is two words
           * filling the width of the screen and is the reason `.display-line`
           * refuses to wrap.
           *
           * The ceiling is 6.75rem rather than the 9 it was at, and it is set
           * by the longest heading on the page rather than by taste. The
           * measure is 940 with 844 inside the gutters, and `NINE WAYS` is
           * nine characters of Bold uppercase: past about 110px it stops
           * fitting, and a `nowrap` line that does not fit is a line hanging
           * off the side of the section for good rather than for the length of
           * an entrance.
           */
          size === "lg"
            ? "text-[clamp(2.5rem,12vw,6.75rem)]"
            : "text-[clamp(2rem,8vw,4.5rem)]",
        )}
      >
        <span data-kinetic-top className="display-line">
          {top}
        </span>
        <span data-kinetic-bottom className="display-line text-right">
          {bottom}
          {stop ? <span className="text-volt">.</span> : null}
        </span>
      </h2>

      {lede ? (
        ledeMotion === "ink" ? (
          <ScrollInk className={LEDE}>{lede}</ScrollInk>
        ) : (
          <p data-kinetic-lede className={LEDE}>
            {lede}
          </p>
        )
      ) : null}
    </div>
  );
}

/*
 * A sentence that inks in word by word as it is scrolled past.
 *
 * The one piece of motion on this page applied to body copy, and it is rationed
 * to two paragraphs for the reason it works at all: it is the reading rate made
 * visible, which is a nice thing to feel once and an obstruction to feel six
 * times. Anywhere the reader has to hold a whole paragraph at once, the egress
 * ledger or the specification column, it would be actively hostile, and it is
 * not used in either.
 *
 * Words are split here rather than by a client component walking text nodes,
 * so the whole paragraph is in the HTML and a machine that never runs the
 * script still reads one sentence rather than forty spans of nothing.
 */
export function ScrollInk({
  children,
  className,
  as = "p",
}: {
  children: string;
  className?: string;
  as?: "p" | "h2" | "h3";
}) {
  const Tag = as as React.ElementType;
  const words = children.split(" ");

  return (
    <Tag data-ink className={className}>
      {words.map((word, i) => (
        /*
         * The space is inside the span rather than between two of them. Left
         * outside, it is a text node nothing ever touches, so the gaps between
         * the unlit words sit at full opacity and the sentence reads as a row
         * of dashes before it lights up.
         */
        <span key={`${word}-${i}`}>
          {word}
          {i === words.length - 1 ? "" : " "}
        </span>
      ))}
    </Tag>
  );
}
