import { ArrowUpRight } from "lucide-react";

import { Desk } from "@/components/site/desk";
import { KineticHeading } from "@/components/site/kinetic";
import { LinkButton } from "@/components/site/link-button";
import { Reveal } from "@/components/site/reveal";
import { links, webAppHost } from "@/lib/site";

/*
 * The web app, straight after the tour of the phone.
 *
 * Placed here because it is the same screens again on a bigger one: the tour
 * ends on the rail of the rest of the phone, and this opens on the dashboard
 * that phone's home tab feeds, with the same 44,282 kg on it. The opinion
 * section under it is about reading the log back, which is most of what a
 * browser is for, so the argument carries on across the gap.
 *
 * A kinetic title, the fifth. The rationing in `components/site/kinetic.tsx`
 * is about load: a title of this weight is for a section the page would be
 * lying without, and "it is also in a browser" is a fact a reader decides on
 * before they install anything.
 *
 * What it leaves out is said as plainly as what it has. There is no workout
 * screen in the browser, and a reader who assumes there is will be annoyed at
 * exactly the wrong moment, so the paragraph beside the button says so.
 */
export function Web() {
  return (
    <section id="web" className="overflow-x-clip pt-step">
      <div className="shell">
        <KineticHeading
          top="At the"
          bottom="desk"
          lede="The log you write on the phone, laid out for a window. Sign in and the whole year is on a screen you can sit back from: statistics, routines, the library and your measurements."
        />
      </div>

      <div className="mt-14 sm:mt-20">
        <Desk />
      </div>

      <div className="shell">
        <Reveal className="mt-20 grid gap-10 border-t border-line pt-10 sm:mt-28 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-12 lg:gap-20">
          <div>
            <h3 className="display-tight text-[clamp(1.5rem,2.6vw,2rem)] text-balance">
              Logging stays on the phone<span className="text-volt">.</span>
            </h3>
            <p className="mt-5 max-w-[46ch] text-[1.0625rem] leading-[1.7] text-fg-2">
              There is no workout screen in the browser, and that is on
              purpose. A set is logged with the bar in reach and the network
              optional, which is a phone&rsquo;s job. The browser is where you
              sit down afterwards to read the year back and plan the next week.
            </p>
          </div>

          <div className="md:pt-1">
            <LinkButton size="hero" variant="volt" href={links.webApp} className="w-full sm:w-auto">
              Open the web app
              <ArrowUpRight />
            </LinkButton>
            <p className="figure mt-4 text-sm text-fg-2">{webAppHost}</p>
            <p className="mt-6 max-w-[44ch] text-[0.9375rem] leading-[1.7] text-fg-3">
              Sign in with the account your phone syncs to, or make one there.
              Running your own server? The web app is in the same compose file,
              so it reads from yours instead.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
