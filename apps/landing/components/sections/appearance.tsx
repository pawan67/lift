import Image from "next/image";

import { ChapterHeading } from "@/components/site/chapter";
import { PhoneFrame } from "@/components/site/phone";
import { DEFAULT_PALETTE, palettes } from "@/lib/palettes";
import { cn } from "@/lib/utils";

/*
 * The one section on the page you can operate.
 *
 * Everything above it describes the app; this hands you a control off it. Pick
 * a palette and the phone in the other column is that palette, because all
 * eight of those are photographs of the same screen in the same state, taken in
 * one run by `scripts/screenshots/capture.mjs`. Nothing here is a recolour, a
 * filter, or a CSS variable swapped over a picture: the app rendered each one.
 *
 * It is worth a section rather than a sentence because "nine themes" is the
 * kind of feature-list line every tracker has, and the appearance screen in the
 * app only half settles it. That screen shows nine swatches, and a swatch is a
 * promise about a screen rather than the screen. This is the screen.
 *
 * **There is no JavaScript in it.** Eight radios, eight screenshots, and
 * `:has()` on the element wrapping both, which is what makes it work in a
 * browser with scripting off and costs nothing on one without. The radios are
 * also why it can be operated from a keyboard without anybody writing key
 * handling: a radio group already does arrows, and Tab already skips the seven
 * that are not selected.
 */
export function Appearance() {
  /*
   * `close`. This reopens one of the screens the tour above just showed, in
   * eight palettes, so it is the same movement continuing rather than a new
   * one starting.
   */
  return (
    <section id="appearance" className="overflow-x-clip pt-close">
      <div className="shell">
        <ChapterHeading
          title="Nine ways to look"
          lede="Pick one and the screen changes. Every one of these is a photograph of the same home tab taken in that palette, not a picture with a filter over it."
        />

        {/*
          `group` is load-bearing. It is the nearest common ancestor of the
          radios and the screens they control, and `:has()` on it is the whole
          switching mechanism, so a wrapper added between it and either column
          is fine but moving the class off it turns the picker off.
        */}
        <div className="group mt-14 grid items-center gap-14 sm:mt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          {/*
            A real fieldset of real radios. It could have been eight buttons and
            a piece of state, and then it would need a client component, a
            hydration boundary, and a story about what the page does before that
            arrives. A radio group has all of that already, and the checked one
            survives a back button.
          */}
          <fieldset className="order-2 lg:order-1">
            <legend className="label text-fg-3">Pick a palette</legend>

            {/*
              One column at `lg`, two in between, one again on a phone.
              Reading that sequence as a mistake is fair and it is not one: the
              track this sits in is 468px wide against a 940 measure, and split
              in two that is 218px for a 44px swatch, a name and a gloss. Every
              second gloss wrapped to three lines and the column stopped
              reading as a list of eight things. At `sm` there is no device
              beside it, so the same list has the whole width and two columns
              fit.
            */}
            <ul className="mt-7 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-1 lg:gap-x-8">
              {palettes.map((palette) => (
                <li key={palette.id}>
                  {/*
                    The radio sits immediately before its own label, so the
                    swatch's selected and focused states are a plain `peer-*`
                    away and need none of the per-palette wiring the screens do.
                    It is `sr-only` rather than hidden: `display: none` takes an
                    input out of the tab order, and this group is meant to be
                    arrow-keyed.
                  */}
                  <input
                    id={`palette-${palette.id}`}
                    type="radio"
                    name="palette"
                    defaultChecked={palette.id === DEFAULT_PALETTE}
                    className="peer sr-only"
                  />

                  {/*
                    The checked and focused states are carried by the label
                    rather than by the swatch inside it, and that is a
                    constraint rather than a preference: `peer-*` compiles to a
                    sibling combinator, so it reaches the label the input sits
                    next to and nothing nested in it. The row lighting up is
                    also the better signal at this size, since a ring drawn
                    around a 44px tile of somebody else's colours is a ring
                    competing with them.
                  */}
                  <label
                    htmlFor={`palette-${palette.id}`}
                    className="group/row flex cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2.5 text-fg ring-1 ring-transparent transition-colors ring-inset hover:bg-surface peer-checked:bg-surface peer-checked:text-volt peer-checked:ring-line-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-volt"
                  >
                    {/*
                      The app's own preview tile at a fortieth of the size: a
                      ground, a panel of the surface on it, and a bar of the one
                      colour that palette actually spends. Three flat colours
                      are enough to tell eight apart, and a gradient here would
                      be inventing a colour none of them have.
                    */}
                    <span
                      aria-hidden
                      style={{ background: palette.background }}
                      className="flex size-11 shrink-0 flex-col justify-end gap-1 rounded-lg p-1.5 ring-1 ring-line-strong transition-transform ring-inset group-hover/row:scale-105"
                    >
                      <span
                        style={{ background: palette.surface }}
                        className="h-full w-full rounded-sm"
                      />
                      <span
                        style={{ background: palette.accent }}
                        className="h-1.5 w-2/3 rounded-full"
                      />
                    </span>

                    <span className="min-w-0">
                      {/* No colour of its own: it inherits the label's, which
                          is what the checked state changes. */}
                      <span className="block text-[0.9375rem] font-medium">
                        {palette.label}
                      </span>
                      <span className="block text-[0.8125rem] leading-snug text-fg-3">
                        {palette.note}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <p className="mt-8 max-w-[46ch] px-3 text-[0.9375rem] leading-[1.7] text-fg-3">
              The ninth is System, which follows the phone. Every other one holds,
              which is the point of choosing it: somebody who picks Gruvbox
              wants Gruvbox at six in the morning as well.
            </p>
          </fieldset>

          <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
            <div className="relative">
              <div
                aria-hidden
                className="screen-cast pointer-events-none absolute -inset-x-[38%] -inset-y-[14%]"
              />

              <PhoneFrame
                size="lg"
                className="relative"
                sizes="(max-width: 1024px) 60vw, 288px"
              >
                {palettes.map((palette) => (
                  <Image
                    key={palette.id}
                    src={palette.shot}
                    /*
                      Every screen is described, because every one of them can
                      be the visible one and the alt text has to be true of
                      whichever that is. The seven underneath are at zero
                      opacity rather than removed, which is what makes the
                      switch instant instead of a fetch.
                    */
                    alt={`The home tab in the ${palette.label} palette`}
                    fill
                    sizes="(max-width: 1024px) 60vw, 288px"
                    quality={88}
                    className={cn(
                      "object-cover opacity-0 transition-opacity duration-500 ease-[var(--ease-out-quint)]",
                      palette.reveal,
                    )}
                  />
                ))}
              </PhoneFrame>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
