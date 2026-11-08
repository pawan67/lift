"use client";

import { Lock } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { deskScreens } from "@/lib/desk";
import { webAppHost } from "@/lib/site";
import { cn } from "@/lib/utils";

/*
 * The web app in a browser window, and the one figure on the page wider than
 * the 940 column.
 *
 * That is not the page relaxing its own rule. Every other picture here is a
 * phone, and a phone is narrower than the measure, so the measure holds it with
 * room either side. This is the one screen that is wider than a column by
 * nature: set at 844px a dashboard built for a 1440 window is a thumbnail of
 * itself, and the whole claim of the section is that there is a bigger screen.
 * So it takes up to 75rem and the type around it stays in the column.
 *
 * The window is drawn rather than photographed. Three dots and an address bar
 * is all a reader needs to see "browser", and a real browser's chrome would
 * date the picture the first time that browser restyled its tabs. The dots are
 * greys rather than traffic lights because the page has one colour in it.
 *
 * Five screens behind five tabs, cycling on their own until somebody picks one.
 * The cycle is a CSS animation on the active tab's bar and `animationend` moves
 * it on, so there is no timer to keep in step with anything: hovering the
 * window pauses the bar, and so does scrolling it out of view, through one
 * `animation-play-state`. Once a tab is clicked the cycle stops for good,
 * because a picture that changes under a reader who has just chosen it is
 * arguing with them. Under reduced motion it never starts.
 *
 * The screens crossfade rather than slide. They are five views of one app at
 * one address, not five places, so nothing should travel.
 */
const CYCLE_MS = 6500;

export function Desk() {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);

  // Starts after hydration, and only for a reader who has not asked for less motion.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a media query once mounted
    setAuto(!query.matches);
    const onChange = () => {
      if (query.matches) setAuto(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Below `sm` the tabs are a row that scrolls sideways; keep the active one on it.
  useEffect(() => {
    const tab = tabs.current[active];
    const row = tab?.parentElement;
    if (!tab || !row || row.scrollWidth <= row.clientWidth) return;
    const left = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
    row.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  const pick = (index: number, focus = false) => {
    setAuto(false);
    setActive(index);
    if (focus) tabs.current[index]?.focus();
  };

  const onKey = (event: KeyboardEvent) => {
    const last = deskScreens.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      pick(moves[event.key]!, true);
    }
  };

  const running = auto && inView && !paused;
  const screen = deskScreens[active]!;

  return (
    <div
      ref={root}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      {/*
        The tabs sit in the column, over the window rather than under it: at
        1200px wide the window is most of a screen tall, and tabs below it are
        tabs nobody sees while they are looking at what the tabs change. The
        bar on top of each one does double duty: it marks the active screen
        and, while the cycle runs, it is the clock.
      */}
      <div className="shell">
        <div
          role="tablist"
          aria-label="Screens of the web app"
          onKeyDown={onKey}
          className="-mx-(--gutter) flex gap-5 overflow-x-auto px-(--gutter) pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 sm:pb-0"
        >
          {deskScreens.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabs.current[index] = el;
                }}
                id={`${id}-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => pick(index)}
                className="group w-[5.75rem] shrink-0 rounded-sm text-left sm:w-auto"
              >
                <span aria-hidden className="block h-px w-full overflow-hidden bg-line-strong">
                  <span
                    key={selected && auto ? `run-${active}` : "still"}
                    onAnimationEnd={() => {
                      if (selected && auto) setActive((index + 1) % deskScreens.length);
                    }}
                    style={
                      selected && auto
                        ? {
                            animationDuration: `${CYCLE_MS}ms`,
                            animationPlayState: running ? "running" : "paused",
                          }
                        : undefined
                    }
                    className={cn(
                      "desk-progress block h-full w-full origin-left bg-volt",
                      selected && (auto ? "desk-progress-run" : "desk-progress-full"),
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "mt-3 block text-[0.8125rem] font-medium transition-colors duration-200 sm:mt-4 sm:text-[0.9375rem]",
                    selected ? "text-fg" : "text-fg-3 group-hover:text-fg-2",
                  )}
                >
                  {item.label}
                </span>
                <span
                  className={cn(
                    "mt-1.5 hidden text-sm leading-[1.55] transition-colors duration-200 md:block",
                    selected ? "text-fg-2" : "text-fg-3/70",
                  )}
                >
                  {item.line}
                </span>
              </button>
            );
          })}
        </div>

        {/* Below `md` there is no room for five lines, so the active one sits under the row. */}
        <p className="mt-4 min-h-[3em] text-[0.9375rem] leading-[1.55] text-fg-2 md:hidden">
          {screen.line}
        </p>
      </div>
      {/* The window. `data-desk` is the hook the scroll scrub tilts up. */}
      <div className="desk-stage relative mx-auto mt-8 w-[min(72rem,calc(100vw-2*var(--gutter)))] sm:mt-12">
        <div aria-hidden className="desk-cast pointer-events-none absolute -inset-x-[12%] -top-[10%] -bottom-[20%]" />

        <figure data-desk className="desk-frame relative overflow-hidden rounded-[0.875rem] border border-line-strong bg-surface sm:rounded-[1.125rem]">
          <div className="flex h-8 items-center gap-3 border-b border-line bg-surface px-3 sm:h-11 sm:px-4">
            <div aria-hidden className="flex gap-1.5 sm:gap-2">
              <span className="size-2 rounded-full bg-surface-4 sm:size-2.5" />
              <span className="size-2 rounded-full bg-surface-4 sm:size-2.5" />
              <span className="size-2 rounded-full bg-surface-4 sm:size-2.5" />
            </div>
            <div className="mx-auto flex h-5 min-w-0 max-w-[70%] items-center gap-1.5 rounded-md bg-surface-2 px-2.5 text-[10px] sm:h-7 sm:w-[22rem] sm:justify-center sm:px-3 sm:text-[13px]">
              <Lock aria-hidden className="size-2.5 shrink-0 text-fg-3 sm:size-3" />
              <span className="truncate">
                <span className="text-fg-2">{webAppHost}</span>
                <span className="text-fg-3">{screen.path === "/" ? "" : screen.path}</span>
              </span>
            </div>
            {/* Balances the dots so the address sits in the middle of the bar. */}
            <div aria-hidden className="w-[2.25rem] sm:w-[3.25rem]" />
          </div>

          <div
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${active}`}
            className="relative aspect-[1440/900] bg-ink"
          >
            {deskScreens.map((item, index) => (
              <Image
                key={item.id}
                src={item.src}
                alt={index === active ? item.alt : ""}
                aria-hidden={index !== active}
                placeholder="blur"
                sizes="(min-width: 1280px) 1200px, 100vw"
                className={cn(
                  "absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500 ease-out",
                  index === active ? "opacity-100" : "opacity-0",
                )}
              />
            ))}
          </div>
        </figure>
      </div>

    </div>
  );
}
