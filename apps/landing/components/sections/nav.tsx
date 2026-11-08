"use client";

import { useEffect, useRef } from "react";
import { Download, Monitor } from "lucide-react";

import { LinkButton } from "@/components/site/link-button";
import { Wordmark } from "@/components/site/mark";
import { links } from "@/lib/site";

/*
 * A wordmark, three links and the one button the page is asking anybody to
 * press.
 *
 * The progress rule came out of here. It was borrowed from the app, which puts
 * how much of the workout is left across the top of the workout screen, and
 * the borrowing was the mistake: a workout has an end you are working toward
 * and a marketing page does not. What it actually reported was how much
 * scrolling was left, which is a fact about the document rather than about
 * anything the reader wants, and it put a moving lime bar across the top of
 * every screenshot on the page. It also cost the only per-frame work in this
 * component.
 *
 * Three section links, down from six plus a Source link. Six is a table of
 * contents, and a table of contents is what you build when you do not trust
 * the page to be worth scrolling. These three are the argument: what it looks
 * like, that it works with the network off, and that you can run the server.
 * Everything else is reached by reading, which is the intended way through.
 *
 * Source went with them. It is in the hero, in the footer twice, and behind
 * the button's neighbour in every section that makes a checkable claim.
 *
 * Nothing in here re-renders. The spy sets `data-active` on a link and the
 * sentinel toggles one attribute on the header; putting either into React
 * state would re-render the header down the length of the page.
 */
const SECTIONS = [
  { id: "screens", label: "Screens" },
  { id: "web", label: "Web" },
  { id: "offline", label: "Offline" },
  { id: "self-host", label: "Self-host" },
];

export function Nav() {
  const header = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const headerEl = header.current;
    const sentinelEl = sentinel.current;
    if (!headerEl || !sentinelEl) return;

    /*
     * The header's hairline, which is on once the page has moved off the top
     * and off while it is over the hero.
     *
     * A sentinel rather than a scroll handler. The old one ran on every scroll
     * event to compare one number, which is per-frame work to answer a
     * question that changes twice in a session. This fires exactly those two
     * times.
     */
    const edge = new IntersectionObserver(
      ([entry]) => {
        headerEl.toggleAttribute("data-scrolled", !entry.isIntersecting);
      },
      { threshold: 0 },
    );
    edge.observe(sentinelEl);

    /*
     * The spy takes whichever section is crossing the middle of the viewport.
     * A default root would mark a section active the moment one pixel of it
     * appears at the bottom, so two links light up at once through every
     * transition.
     */
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          list.current
            ?.querySelectorAll<HTMLAnchorElement>("[data-section]")
            .forEach((link) => {
              link.toggleAttribute("data-active", link.dataset.section === id);
            });
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );

    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) spy.observe(el);
    }

    return () => {
      edge.disconnect();
      spy.disconnect();
    };
  }, []);

  return (
    <>
      {/*
        Absolutely positioned with no positioned ancestor, so it resolves
        against the initial containing block: the top of the document, which is
        exactly the thing being watched. It takes no space and paints nothing.
      */}
      <div
        ref={sentinel}
        aria-hidden
        className="pointer-events-none absolute top-0 h-6 w-px"
      />

      <header
        ref={header}
        className="sticky top-0 z-50 border-b border-transparent bg-ink transition-colors duration-300 data-scrolled:border-line"
      >
        <nav aria-label="Main" className="shell flex h-16 items-center gap-8">
          <a
            href="#top"
            className="rounded-sm text-fg transition-colors hover:text-volt"
          >
            <Wordmark id="mark-nav" />
            <span className="sr-only">Lift, back to top</span>
          </a>

          {/*
            `sm` rather than the `lg` this needed at six links plus Source.
            Three labels and the button clear 640px with room over, so the
            links are now there on a phone held sideways instead of only on a
            laptop.
          */}
          <ul
            ref={list}
            className="ml-auto hidden items-center gap-7 sm:flex"
          >
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  data-section={section.id}
                  className="underline-draw text-sm text-fg-2 transition-colors hover:text-fg data-active:text-volt"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>

          {/*
            The web app beside the download from `lg`, where the row has the
            width for both. Below that the hero's second button and the
            `Web` link above carry it, and a header with two buttons on a
            phone is a header that is mostly buttons.
          */}
          <LinkButton
            size="touch"
            variant="wire"
            className="hidden lg:inline-flex"
            href={links.webApp}
          >
            <Monitor />
            Web app
          </LinkButton>

          <LinkButton
            size="touch"
            variant="volt"
            className="ml-auto sm:ml-0 lg:-ml-5"
            href={links.release}
          >
            <Download />
            Get the app
          </LinkButton>
        </nav>
      </header>
    </>
  );
}
