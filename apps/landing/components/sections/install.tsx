import { Download, Monitor } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { GitHubMark } from "@/components/site/icons";
import { LinkButton } from "@/components/site/link-button";
import { Mark } from "@/components/site/mark";
import { formatBytes, type Release } from "@/lib/release";
import { links, webAppHost } from "@/lib/site";

/*
 * The one lime surface on the page.
 *
 * Everything above it is a true-black canvas with the accent rationed to a
 * full stop, a rule and a dot, because that is how the app treats it. Spending
 * the whole colour at the end, once, on the only thing the page is asking
 * anybody to do, is what makes the rationing read as deliberate rather than as
 * a page that ran out of ideas.
 *
 * The type on it is `--volt-ink`, the app's own foreground for a lime fill.
 * White here measures around 2:1.
 */
const CAVEATS = [
  {
    q: "Android is going to warn me about this.",
    a: "It is. The file does not come from the Play Store, so the first time you open one Android asks you to allow installs from your browser. Say yes once and it stops asking. New releases install straight over the old one and your log is untouched.",
  },
  {
    q: "Will it run on my phone?",
    a: "If it is an Android phone from roughly the last decade, yes. Anything older, or an unusual chip, and there are other builds available from the project's build page.",
  },
  {
    q: "Is there an iPhone build?",
    a: "Not one that can be handed out. The app itself builds and runs on iOS perfectly well, so if you are set up to build iOS apps you can put it on your own phone today. Otherwise this is Android for now.",
  },
  {
    q: "Is there a web version?",
    a: `Yes, at ${webAppHost}. It is the desk half of Lift: statistics, history, records, the exercise library, routines and measurements, read from the log your phone syncs. It has no workout screen, so sets are still logged on the phone, and it needs the account the phone signs in with.`,
  },
];

export function Install({ release }: { release: Release | null }) {
  return (
    <section id="get">
      <div className="on-volt relative overflow-hidden bg-volt text-volt-ink">
        {/*
          Sized to fit inside the slab rather than bled off it. Cropped at 128%
          the mark stopped being a mark: what showed was three hard-edged
          rectangles in a corner, which is the decorative-blob move this page is
          otherwise free of. Whole, at six percent, it is a watermark and reads
          as the thing it is.
        */}
        <Mark
          id="mark-slab"
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-[5%] hidden h-[68%] w-auto -translate-y-1/2 text-volt-ink/[0.07] sm:block"
        />

        {/*
          Deliberately not wrapped in `Reveal`. This is the one thing the page
          is asking anybody to do, and an element that starts at zero opacity
          and waits for an IntersectionObserver has a state where it is simply
          not there. Everything else on the page can afford that; this cannot.
        */}
        <div className="shell relative py-24 sm:py-32 lg:py-36">
          <div className="max-w-4xl">
            <h2 className="display max-w-[14ch] text-[clamp(2.75rem,11vw,6rem)]">
              Download it and log one set.
            </h2>
            <p className="mt-7 max-w-[42ch] text-[1.1875rem] leading-[1.5] text-volt-ink/80 sm:text-2xl sm:leading-[1.45]">
              That is the whole evaluation. If it is not faster than what you are
              using, nothing was signed up for and nothing needs cancelling.
            </p>

            <div className="mt-10 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              <LinkButton size="hero" variant="ink" href={links.release}>
                <Download />
                {release ? `Download ${release.tag}` : "Download the APK"}
              </LinkButton>
              <LinkButton size="hero" variant="wire-ink" href={links.webApp}>
                <Monitor />
                Open the web app
              </LinkButton>
            </div>

            {/*
              70% rather than 60. Composited over the lime, a 60% ink measures
              4.36 against it, which is under AA; 70% reads 6.02. Every other
              tint on this slab is a rule and has no ratio to meet.
            */}
            <p className="mt-8 text-[0.9375rem] text-volt-ink/70">
              An Android install file
              {release?.apkBytes ? `, ${formatBytes(release.apkBytes)}` : ""},
              free software under the AGPL-3.0. Nothing to sign up for.
              <a
                href={links.repo}
                className="underline-draw mt-3 flex w-fit items-center gap-1.5 font-medium text-volt-ink"
              >
                <GitHubMark className="size-3.5" />
                Or build it yourself
              </a>
            </p>
          </div>
        </div>
      </div>

      <div>
        {/*
          Same container and gutters as every other section, with the reading
          measure applied inside it. Centring a narrower container instead would
          put this section's index two hundred pixels right of the five above
          it, which is the sort of thing you only see once you scroll past both.
        */}
        <div className="shell py-20 sm:py-24">
          <h2 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)]">
            Before you install
          </h2>

          <Accordion className="mt-8 max-w-3xl">
            {CAVEATS.map((item) => (
              <AccordionItem key={item.q} value={item.q}>
                <AccordionTrigger className="py-5 text-base font-medium text-fg hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-[0.9375rem] leading-[1.7] text-fg-2">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <p className="mt-10 max-w-[62ch] text-sm leading-relaxed text-fg-3">
            Every release is built automatically from the public source, not off
            anybody&rsquo;s laptop, so you can see exactly what produced the file
            before you install it.
          </p>
        </div>
      </div>
    </section>
  );
}
