import { ArrowUpRight } from "lucide-react";

import { ChapterHeading } from "@/components/site/chapter";
import { Reveal } from "@/components/site/reveal";
import { links } from "@/lib/site";

/*
 * The one section on the page that is only prose.
 *
 * It used to be a bordered card with a header strip and four rules across it,
 * which was the third thing on this page built to that exact recipe. Repeating
 * a container is what makes a page read as generated: no reader counts the
 * cards, but they feel the sameness. The subject also does not want a table.
 * "You do not have to sign in" is a reassurance, and reassurances are made of
 * sentences.
 */
export function Sync() {
  /*
   * `turn`, the last of the three. Everything above this section is about a
   * phone with nothing behind it; this one and the one under it are about
   * the machine you can put behind it if you want to, which is a different
   * argument addressed to a different reader.
   */
  return (
    <section id="sync" className="overflow-x-clip pt-turn">
      <div className="shell">
        <ChapterHeading
          title="Sign in, or don’t"
          lede="An account is optional and it stays optional. All it buys is a second copy of the log, and nothing is held back until you ask for one."
        />

        {/*
          One column, capped at a measure. It was two, which was right against
          a 1280 track and is not against 940: halved, each paragraph came out
          at 36 characters, and a two-line sentence set 36 characters wide is a
          newspaper column with the news taken out.
        */}
        {/*
          Three paragraphs, not two, and not a word of it is new.

          The two it replaces were four and five sentences long and each of them
          changed subject halfway through: the first opened on what an account
          buys and finished on what happens when the signal drops, the second
          opened on conflicts and finished on what happens if you never sign in
          at all. This is the only stretch of the page with no picture in it for
          several screens, so a paragraph that has to be read twice to find
          where it turns is the one thing it cannot afford.

          Split on the turns instead, the section answers three questions in
          order: what signing in adds, how it behaves when the network or a
          second phone gets in the way, and what it costs you to ignore.
        */}
        <Reveal className="mt-14 max-w-[46rem] sm:mt-16">
          <div className="space-y-6 text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
            <p>
              Signing in adds a backup and the same log on a second phone. It
              adds nothing else and it is not a tier.
            </p>
            <p>
              Workouts are written on the phone and sent afterwards, so losing
              signal mid session changes nothing, and a sync cut off halfway is
              picked up by the next one rather than handing you the same workout
              twice. Edit the same session in two places and the most recent
              edit is the one that keeps. Delete it on one phone and it goes on
              the other.
            </p>
            <p>
              Nothing stops working if you never sign in: not a trial, not a
              screen waiting behind a login. Where that second copy sits is the
              next thing on this page.
            </p>
          </div>

          <a
            href={links.readme}
            className="underline-draw mt-10 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-volt"
          >
            How the syncing works underneath
            <ArrowUpRight className="size-4" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
