import { Appearance } from "@/components/sections/appearance";
import { Details } from "@/components/sections/details";
import { Footer } from "@/components/sections/footer";
import { Hero } from "@/components/sections/hero";
import { Install } from "@/components/sections/install";
import { Nav } from "@/components/sections/nav";
import { Offline } from "@/components/sections/offline";
import { Opinion } from "@/components/sections/opinion";
import { Portable } from "@/components/sections/portable";
import { Privacy } from "@/components/sections/privacy";
import { Screens } from "@/components/sections/screens";
import { SelfHost } from "@/components/sections/self-host";
import { Sync } from "@/components/sections/sync";
import { ScrollMotion } from "@/components/site/scroll-motion";
import { latestRelease } from "@/lib/release";

/*
 * Fetched once here and handed down, rather than called in both places that
 * print it. Next would dedupe two identical fetches inside one render anyway,
 * but one call site is one thing to reason about, and it makes it obvious that
 * the hero's version badge and the download button cannot disagree.
 */

/*
 * **The order below is an argument, and the spacing is now how it is made.**
 *
 * Every section used to open on the same `py-24 sm:py-36 lg:py-44` and the
 * same two-word kinetic title, so the comments in this file were the only
 * place the structure existed. A reader scrolling it got nine identical
 * headings separated by nine identical gaps, which says the nine sections are
 * a list. They are not a list, they are five movements.
 *
 * Both of those are carried now. Each section declares one of three gaps,
 * `pt-close`, `pt-step` or `pt-turn` (see `app/globals.css`), and opens on one
 * of two headings: `KineticHeading` for the four that are load bearing, and
 * `ChapterHeading` for the five that support them. Where a comment here claims
 * two sections belong together, the gap between them is `close` and the second
 * one opens quietly; where it claims the subject changes, the gap is `turn`.
 *
 *   hero -> details        close   the first screen, then six things about it
 *   details -> appearance  close   the same screens, in eight palettes
 *   appearance -> screens  step    the tour                        [kinetic]
 *   screens -> opinion     turn    writing down -> reading back
 *   opinion -> offline     turn    the thesis                      [kinetic]
 *   offline -> portable    close   what follows from it
 *   portable -> privacy    close   the ledger the two above build to [kinetic]
 *   privacy -> sync        turn    the phone -> the machine behind it
 *   sync -> self-host      close   the answer sync leaves you holding [kinetic]
 */
export default async function Home() {
  const release = await latestRelease();

  return (
    <>
      {/*
        Renders nothing. It is the one client component on the page, and it is
        mounted here rather than in `layout.tsx` because everything it drives is
        on this route: a 404 has no kinetic headings to scrub and should not be
        paying for a tween engine to find that out.
      */}
      <ScrollMotion />

      <Nav />

      <main className="flex-1">
        <Hero release={release} />

        {/*
          The hero hands straight to the tour. There was a band of 52 shaded
          cells in between, captioned as illustrative, and "illustrative" was
          the problem: every other picture on this page is the app's own
          arithmetic over a real generated year, and this was a drawing of a
          calendar sitting one screen above a photograph of the calendar. One
          of the two had to go and it was not going to be the photograph.
        */}

        <Details />
        {/*
          Straight after the tour, because it is about the same screens. The
          tour ends on a rail of four more of them and this reopens one of the
          four in eight palettes, which is the only place on the page where a
          reader gets to change something rather than read about it.
        */}
        <Appearance />
        <Screens />

        {/*
          Six features that had no place on the page before there was artwork
          for them: the rest timer, the superset link, the plate calculator, the
          widgets, the bell's output stream and the records. None of the six has
          a screen worth photographing at tile width, which is why every one of
          them was a line in the README and nothing here.
        */}

        <Opinion />
        <Offline />
        <Portable />

        {/*
          The ledger sits here rather than up beside the offline guarantees, and
          the order is the argument. By this point the page has said where the
          training is kept and shown both doors it can leave by; what a reader
          wants next is the list of everything that leaves without being
          carried, and the last two rows of that list hand straight over to the
          two sections about sync.
        */}
        <Privacy />

        <Sync />
        <SelfHost />
        <Install release={release} />
      </main>

      <Footer />
    </>
  );
}
