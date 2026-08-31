import { Download } from "lucide-react";

import { GitHubMark } from "@/components/site/icons";
import { LinkButton } from "@/components/site/link-button";
import { Phone } from "@/components/site/phone";
import { screens } from "@/lib/screens";
import type { Release } from "@/lib/release";
import { links } from "@/lib/site";

/*
 * Hidden below `sm`, because below `sm` there is no row for it to divide.
 *
 * The four facts are about 350px of tracked-out mono and a 375pt phone offers
 * 335, so the row wrapped, and a flex row that wraps breaks wherever it runs
 * out: the tick before "Self-hostable" ended the first line, leaving a rule
 * hanging off the end of it with nothing on the other side. Below `sm` the
 * facts are set as a 2x2 grid instead and divide themselves.
 */
function Tick() {
  return (
    <span
      aria-hidden
      className="hidden h-3 w-px shrink-0 bg-line-strong sm:block"
    />
  );
}

export function Hero({ release }: { release: Release | null }) {
  return (
    <section id="top" data-hero className="relative overflow-x-clip">
      {/*
        Two tracks at `lg`, stacked below it, and the device is back.

        It was stacked at every width for a while, and before that it was a
        two-track grid that did not work: the headline and a 296px phone could
        not both have the width they wanted out of 844, so the headline lost
        and came out at two thirds the size it is set at. Stacking fixed the
        headline and cost the page the one thing a workout tracker's first
        screen should be showing, which is the app. Half a fold of type and
        half a fold of nothing is not restraint, it is a picture that was taken
        out and never replaced.

        What makes the row work this time is that the arithmetic was done in
        the other direction. The old grid kept the headline's clamp and handed
        the phone whatever was left over; this one gives the phone 272 (see
        `--phone-xl` in `app/globals.css`), the gap 64, and lowers the
        headline's ceiling to the 88px that fits the 508 remaining. 88 against
        100 is a twelfth off a figure nobody can measure by eye, and it buys
        the whole device.

        `items-center` rather than `items-start`, and it is safe rather than
        hopeful: the type column sets about 580px tall at `lg` and the frame
        draws 567, so the two are near enough the same height that centring
        them reads as one object instead of as a phone floating beside a
        paragraph.

        Below `lg` nothing here changed. One column, the type at its full
        clamp, and the device under it at 72vw.
      */}
      <div className="shell pt-14 sm:pt-20 lg:pt-24">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
          {/*
            The type. Nothing in here is positioned against the device: it is a
            column that happens to have a column beside it, which is what keeps
            the stacked case identical to what it was.
          */}
          <div>
            <p
              data-hero-spec
              className="label grid w-fit grid-cols-[auto_auto] gap-x-7 gap-y-2.5 text-fg-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3"
            >
              {/* Dropped entirely when the release could not be read, rather
                  than falling back to a number nobody can download. */}
              {release ? (
                <>
                  <span className="text-volt">{release.tag}</span>
                  <Tick />
                </>
              ) : null}
              <span>Android</span>
              <Tick />
              <span>AGPL-3.0</span>
              <Tick />
              {/* Above the fold because it is half of what the page argues and
                  the only fact in this row a reader cannot guess. */}
              <span>Self-hostable</span>
            </p>

            {/*
              The floor is the number that matters: it is what a 390pt screen
              actually gets, and at the 41px this used to be, the headline was
              a heading on a page rather than the first thing in the room.

              The ceiling now comes in two figures rather than one, and the
              second is the price of the device beside it. Below `lg` the type
              has the whole 844 measure and runs to 100px, which is the
              proportion a display headline wants against a column that wide.
              At `lg` the row splits and the type gets 508, so the ceiling
              drops to 88: `Log the set.` sets 481 wide at that size, which
              clears the track with 27px to spare at every viewport from 1024
              up. Raising it means narrowing `--phone-xl` by the same amount.

              Still three lines, broken on purpose rather than left to wrap.
              The headline is two sentences and the break after each one is
              where a reader would take a breath anyway; balancing it instead
              leaves a one-word third line, which is the classic display-type
              failure.
            */}
            <h1
              data-hero-heading
              className="display mt-6 text-[clamp(3rem,9.5vw,6.25rem)] sm:mt-8 lg:text-[clamp(3rem,9.5vw,5.5rem)]"
            >
              Log the set.
              <br />
              Get back
              <br />
              to the bar
              <span className="text-volt">.</span>
            </h1>

            {/*
              Two sentences, down from four. The cut sentences were both true
              and both said again further down the page, at length and with the
              evidence attached: the account is the whole of the sync section
              and the server is the whole of the one under it. A hero that
              already contains the argument leaves the reader nothing to scroll
              for.
            */}
            <p
              data-hero-lede
              className="mt-7 max-w-[42ch] text-[1.1875rem] leading-[1.5] text-fg-2 sm:mt-8 sm:max-w-[46ch] sm:text-[1.5rem] sm:leading-[1.45]"
            >
              Every workout, set, routine and record, in a database on the phone
              in your hand. It opens instantly, works with the network off, and
              never asks you to make an account.
            </p>

            {/*
              A stacked pair at full width below `sm`, a row above it. Wrapped,
              the two of them sat as a pair of ragged 200px slabs down the left
              of a phone; at full width they read as the two things you can do
              next, which is what they are.
            */}
            <div
              data-hero-cta
              className="mt-9 grid gap-3 sm:mt-10 sm:flex sm:flex-wrap sm:items-center"
            >
              <LinkButton size="hero" variant="volt" href={links.release}>
                <Download />
                Download the APK
              </LinkButton>
              <LinkButton size="hero" variant="wire" href={links.repo}>
                <GitHubMark />
                Read the source
              </LinkButton>
            </div>

            <p
              data-hero-note
              className="mt-6 text-sm leading-relaxed text-fg-3"
            >
              No account, no ads, no trackers, no subscription, nothing to
              unlock.
            </p>
          </div>

          {/*
            The device, and the only picture above the fold.

            `justify-center` below `lg`, where it has the row to itself, and
            pushed to the outer gutter at `lg`, where it is the second track and
            centring it in a track exactly its own width would do nothing
            anyway. The explicit `lg:justify-end` is there for the reader
            rather than the browser.
          */}
          <div
            data-hero-device
            className="relative flex justify-center lg:justify-end"
          >
            {/*
              The light the screen throws on the ground behind it. The hero is
              the only place on the page where this is applied to a device that
              is not already the subject of a section, and it is the reason the
              frame does not float: on a true-black canvas an emitting
              rectangle with no cast has no relationship to what it is sitting
              on. Clipped by the section's `overflow-x-clip`, which is why the
              inset can be this generous without widening the document.
            */}
            <div
              aria-hidden
              className="screen-cast pointer-events-none absolute -inset-x-[45%] -inset-y-[18%]"
            />

            <Phone
              data-parallax
              size="xl"
              screen={screens.home}
              priority
              sizes="(min-width: 1024px) 272px, (min-width: 640px) 352px, 72vw"
              className="relative"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
