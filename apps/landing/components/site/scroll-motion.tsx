"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

/*
 * Every animation on the page that is not a hover, in one place.
 *
 * This started as a pure-CSS system built on `animation-timeline: view()`,
 * which was cheaper and worse. A view timeline maps scroll position to
 * animation progress exactly: move the wheel one notch and the type moves one
 * notch, and because a wheel notch is a jump rather than a sweep, so is the
 * type. It is technically the smoothest thing a browser can do and it reads as
 * the least smooth, because there is nothing between the input and the output.
 *
 * What was missing is lag. `scrub` here is a number rather than `true`, which
 * tells ScrollTrigger to *ease toward* the scroll position over that many
 * seconds rather than snap to it, so a notch of wheel becomes a short sweep and
 * a flick becomes a glide that settles after you have stopped.
 *
 * Once a tween engine is on the page it should be doing the whole job rather
 * than three effects, so the hero's entrance moved here too. It used to be four
 * CSS keyframes and five hand-counted `animation-delay` values across two
 * files, which is a timeline written in the least convenient notation there is.
 * As a `gsap.timeline` the delays are positions, the order is readable in one
 * column, and changing the pace is one number instead of five.
 *
 * The cost: 46 KB gzipped for the core and ScrollTrigger, 7 more for SplitText,
 * and animation on the main thread rather than the compositor.
 *
 * Nothing in here is required for the page to be readable. Every element is
 * rendered in its finished state and GSAP moves it *back* to the start, so a
 * reader with no JavaScript, a bot, or anybody whose bundle failed to load gets
 * the whole page rather than a column of nothing. That is also why `matchMedia`
 * is used rather than a bare check: `mm.revert()` puts every element back
 * exactly as it was found, including the text SplitText pulled apart, if the
 * reader turns reduced motion on while the page is open.
 *
 * **Every tween is `fromTo` with both ends written out, and that is not
 * verbosity.** A bare `from()` reads its destination off the DOM when it
 * renders, and ScrollTrigger calls `invalidate()` on refresh, which it does on
 * `load` once the screenshots have decoded. A tween that had already applied
 * its start state by then re-read its destination out of that start state and
 * animated zero to zero. It was silent and it cost an afternoon: the two
 * download buttons were simply not on the finished page. Naming both ends
 * makes a refresh a no-op.
 */

/*
 * Where a section's title starts and finishes arriving.
 *
 * Opened out from `88% -> 42%`, and again from `95% -> 38%`, because the
 * distance the type travels went up by an order of magnitude. Each line starts
 * a full viewport width off the side of the screen rather than 13% of its own
 * width in from it, and covering that in the old range meant a word crossing
 * the whole screen inside a third of a scroll: legible as a blur, not as an
 * arrival. This is roughly two thirds of a screen of scroll for the pair.
 *
 * The range is the *rate* control. Travel is fixed at one viewport width, so
 * the only way to make a title move more slowly is to spend more scroll
 * covering it; shortening the durations below would just make it snap sooner.
 */
const TITLE = { start: "top 98%", end: "top 30%" } as const;

/*
 * How far behind the scroll position each effect is allowed to run, in seconds.
 *
 * This is the page's pace, and it is one object rather than five literals
 * because that is the knob anybody adjusting the feel actually reaches for.
 * `scrub` is a lag, not a duration: ScrollTrigger eases *toward* wherever the
 * scroll is over this many seconds, so a wheel notch becomes a sweep and a
 * flick becomes a glide that keeps going after the wheel has stopped.
 *
 * Raised across the board from `0.7-1.0`. Under a second the type tracks the
 * wheel closely enough that a fast scroll reads as the page being yanked
 * rather than as anything arriving, which is exactly the complaint. Past about
 * 2 it stops reading as momentum and starts reading as latency: the page feels
 * like it is buffering. These sit in the band where the movement is clearly
 * its own thing and still obviously caused by the scroll.
 *
 * Titles get the most because they travel the furthest. Parallax gets more
 * still because it is the one effect with no destination to arrive at, so
 * there is nothing for the extra lag to hold up.
 */
const SCRUB = {
  title: 1.5,
  ink: 1.2,
  callout: 1.3,
  parallax: 1.6,
} as const;

export function ScrollMotion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger, SplitText);

    const mm = gsap.matchMedia();
    const cleanup: Array<() => void> = [];

    /*
     * One `add`, not two.
     *
     * Splitting the hero and the scrubbed sections into two calls with the same
     * query string cost an afternoon: the second registration took the first
     * one's place, so the hero timeline was built, applied its `from` state,
     * and was then killed part-way through. The download buttons sat at zero
     * opacity on the finished page, which is the exact failure every `from()`
     * in this file is written to avoid.
     */
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      /*
       * The hero, on load rather than on scroll.
       *
       * It is already on screen when the page arrives, so there is no scroll
       * behind it to scrub against: a scrubbed hero would sit at its start
       * state on the one screen every reader sees. This is the only timeline
       * here with a clock of its own, and it is the only one that should have.
       */
      const hero = document.querySelector("[data-hero]");
      if (hero) {
        const heading = hero.querySelector("[data-hero-heading]");
        const split = heading
          ? new SplitText(heading, { type: "lines", linesClass: "overflow-hidden" })
          : null;

        /*
         * Split into lines and each line masked by its own `overflow-hidden`,
         * so the type rises out of the line above instead of fading in place.
         * Three lines of a headline arriving one after another is the whole
         * effect, and it only reads as one movement because the stagger is
         * shorter than the duration: they overlap rather than queue.
         *
         * `lines` rather than `chars`. A headline this size has enough weight
         * per line to carry the movement, and forty characters each doing
         * their own thing is a title announcing itself rather than arriving.
         */
        const inner = split
          ? split.lines.flatMap((line) => Array.from(line.children))
          : [];

        /*
         * Stretched by about half from where it started, to a shade under three
         * seconds end to end.
         *
         * This is the one timeline on the page with a clock, so it is the one
         * place where slowing down is literally a longer duration rather than a
         * longer scroll range. It is also the first thing anybody sees, and it
         * sets the expectation every scrubbed effect below is then measured
         * against: a hero that snaps into place followed by titles that glide
         * reads as two pages stitched together.
         *
         * The staggers grew with the durations rather than staying put. A
         * stagger is only a stagger relative to the duration it overlaps: held
         * at 0.09 against a 1.4 second line tween the three headline lines
         * would arrive nearly on top of each other, which is a headline
         * appearing rather than assembling.
         */
        const tl = gsap.timeline({
          defaults: { ease: "power3.out", duration: 1.25 },
        });

        /*
         * Every part of the hero is optional, and the tween is skipped rather
         * than pointed at nothing when one is missing.
         *
         * The rest of this file already works this way, `if (hero)`, `if (top)`,
         * `if (!rows.length) return`; the hero timeline was the one place still
         * handing raw selector strings to GSAP and trusting the markup to
         * match. It stopped matching the moment the device block in
         * `components/sections/hero.tsx` was commented out, and GSAP spent
         * three console warnings per page load saying so: one naming
         * `[data-hero-device]`, then two more with no name at all, which are
         * the `set` calls `fromTo` builds internally once the target list
         * resolves to empty.
         *
         * Warnings are the mild half. A `fromTo` with no targets is a segment
         * of the timeline that occupies its position and animates nothing, so
         * the version of this that silently swallowed the miss would have been
         * worse: the entrance would quietly lose a beat and nothing would say
         * why. Skipping the tween keeps the timeline honest about what is
         * actually on the page.
         */
        const beat = (
          target: gsap.TweenTarget | null,
          from: gsap.TweenVars,
          to: gsap.TweenVars,
          at: number,
        ) => {
          const found = gsap.utils.toArray(target ?? []);
          if (found.length) tl.fromTo(found, from, to, at);
        };

        beat(
          "[data-hero-spec]",
          { y: 12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.85 },
          0,
        );
        beat(
          inner.length ? inner : heading,
          { yPercent: 108 },
          { yPercent: 0, stagger: 0.13, duration: 1.4 },
          0.1,
        );
        beat(
          "[data-hero-lede]",
          { y: 18, autoAlpha: 0 },
          { y: 0, autoAlpha: 1 },
          0.6,
        );
        beat(
          "[data-hero-cta] > *",
          { y: 14, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, stagger: 0.11 },
          0.8,
        );
        beat(
          "[data-hero-note]",
          { y: 10, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.95 },
          1.05,
        );
        beat(
          "[data-hero-device]",
          { yPercent: 6, scale: 0.97, autoAlpha: 0 },
          { yPercent: 0, scale: 1, autoAlpha: 1, duration: 1.7 },
          0.25,
        );

        /*
         * `revert()` on cleanup, not just on the tween. SplitText replaces the
         * heading's markup with a nest of divs, and leaving that behind hands
         * the next mount a heading it has already split once. It is registered
         * with `gsap.context`'s own cleanup rather than returned from here,
         * because everything below shares this one callback and an early
         * `return` would take the rest of the page's animation with it.
         */
        if (split) cleanup.push(() => split.revert());
      }

      /*
       * The two lines of a section title share one timeline rather than taking
       * a trigger each. The offset between them is then a position on that
       * timeline, measured in the same scroll the first line is moving through:
       * give them separate triggers and the gap between them changes with the
       * height of whatever sits above.
       */
      gsap.utils.toArray<HTMLElement>("[data-kinetic]").forEach((block) => {
        const top = block.querySelector("[data-kinetic-top]");
        const bottom = block.querySelector("[data-kinetic-bottom]");
        const lede = block.querySelector("[data-kinetic-lede]");

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: block,
            start: TITLE.start,
            end: TITLE.end,
            scrub: SCRUB.title,
          },
        });

        /*
         * `power2.out` on a scrubbed tween is not the usual advice, which is
         * `none`. The usual advice is right when the animation *is* the scroll
         * readout; this is an entrance that happens to be driven by scroll, and
         * an entrance decelerates. It also means the last third of the range
         * barely moves, so the title is legible for most of the time it is on
         * screen instead of only at the end.
         */
        /*
         * One viewport width of travel, in pixels, measured at the moment the
         * tween is built.
         *
         * This was `xPercent: -100` while the heading was a full-bleed box, on
         * the reasoning that one width of the box was one width of the window.
         * The measure is 940 now and the box is not the window, so a hundred
         * percent of it leaves a word sitting a couple of hundred pixels in
         * from the edge on a wide monitor: visible at the start, which is the
         * one thing this must not be.
         *
         * A window width always clears, whatever the column is doing. The
         * heading cannot start further right than the gutter, so shifting it
         * by the whole viewport always puts its trailing edge off the far
         * side, at 320px and at 2560 alike.
         *
         * It is a function rather than a number so ScrollTrigger re-reads it on
         * every refresh, which is what keeps it right after a resize. That is
         * safe here in a way a bare `from()` would not be: the destination is a
         * literal 0, so a refresh cannot re-read the destination out of the
         * start state and animate nothing to nothing.
         *
         * No fade on either line, which is the change that made the effect
         * work. A word that is both sliding and fading is a word arriving
         * apologetically, and there is nothing to hide behind a fade here:
         * where it starts is outside the clip, so it is already invisible.
         *
         * `power3.out` rather than `power2.out`, because the travel is long. A
         * gentler curve spends the middle of the range with a word halfway
         * across the screen; this one is two thirds of the way home a third of
         * the way through the scroll, so the heading is settled and readable
         * for most of the time it is actually on screen.
         */
        const offscreen = () => window.innerWidth;

        /*
         * The durations are written out rather than left at GSAP's default 0.5,
         * because on a scrubbed timeline a duration is a *share of the scroll
         * range*, not a length of time. At the default the two lines were done
         * inside the first two thirds of the range and the last third was the
         * lede alone; at 0.85 they use most of it, so the same travel is spread
         * over more wheel and the type moves more slowly for it.
         *
         * `power3.out` survives the slowdown, and it is worth saying why, since
         * a hard ease-out is the usual suspect when something feels whippy. The
         * whip was never the curve, it was the curve against too little scroll:
         * the lag above is a low-pass filter on the whole thing, so a flick can
         * no longer be tracked instantly however steep the start of the ease
         * is. What `power3.out` still buys is the property the range change
         * would otherwise have cost, which is that the heading is home and
         * readable well before it leaves the screen.
         */
        if (top) {
          tl.fromTo(
            top,
            { x: () => -offscreen() },
            { x: 0, ease: "power3.out", duration: 0.85 },
            0,
          );
        }
        if (bottom) {
          tl.fromTo(
            bottom,
            { x: offscreen },
            { x: 0, ease: "power3.out", duration: 0.85 },
            0.16,
          );
        }
        if (lede) {
          tl.fromTo(
            lede,
            { y: 24, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, ease: "power2.out", duration: 0.55 },
            0.62,
          );
        }
      });

      /*
       * The word-by-word fill. Not from zero: a word at no opacity is a hole in
       * a sentence, and a sentence with a moving hole in it is unreadable
       * rather than animated.
       *
       * The stagger is normalised by word count, so a forty-word paragraph and
       * a twelve-word one take the same amount of scroll to fill. Left as a
       * fixed per-word step the long one would still be lighting up two screens
       * after you had read it.
       */
      gsap.utils.toArray<HTMLElement>("[data-ink]").forEach((para) => {
        const words = para.querySelectorAll("span");
        if (!words.length) return;

        gsap.fromTo(
          words,
          { opacity: 0.14 },
          {
            opacity: 1,
            ease: "none",
            /*
             * The per-word fade, lengthened from 0.6. Against a stagger step of
             * `2 / words.length` this is what decides how many words are part
             * lit at once: short, and the sentence fills one hard-edged word at
             * a time, which is the tick of a counter. Long, and there is a soft
             * band of three or four words moving across the line, which is what
             * reading actually looks like.
             */
            duration: 0.95,
            stagger: 2 / words.length,
            scrollTrigger: {
              trigger: para,
              start: "top 88%",
              end: "bottom 50%",
              scrub: SCRUB.ink,
            },
          },
        );
      });

      /*
       * The callout rails on an annotated device. The rule draws first and the
       * label follows it out, which is the order the eye wants: a label that
       * arrives before the line pointing at anything is a caption floating in
       * the gutter.
       */
      gsap.utils.toArray<HTMLElement>("[data-callouts]").forEach((group) => {
        const rules = group.querySelectorAll("[data-callout-rule]");
        const labels = group.querySelectorAll("[data-callout-label]");
        if (!rules.length) return;

        gsap
          .timeline({
            scrollTrigger: {
              trigger: group,
              start: "top 84%",
              end: "top 22%",
              scrub: SCRUB.callout,
            },
          })
          .fromTo(
            rules,
            { scaleX: 0 },
            { scaleX: 1, ease: "power2.out", stagger: 0.2, duration: 0.7 },
            0,
          )
          .fromTo(
            labels,
            { autoAlpha: 0, y: 6 },
            { autoAlpha: 1, y: 0, ease: "none", stagger: 0.2, duration: 0.55 },
            0.16,
          );
      });

      /*
       * The browser window rising off the desk as it scrolls in.
       *
       * Hinged on its bottom edge (see `.desk-frame`) and tipped back 16
       * degrees, it stands up to face the reader over the first two thirds of
       * the screen it travels, and is flat and still by the time it is the
       * thing being looked at. Nothing moves once it is: a window that keeps
       * tilting while somebody tries to read a chart on it is the effect
       * getting in the way of the picture.
       */
      gsap.utils.toArray<HTMLElement>("[data-desk]").forEach((frame) => {
        gsap.fromTo(
          frame,
          { rotateX: 16, scale: 0.92, autoAlpha: 0.35 },
          {
            rotateX: 0,
            scale: 1,
            autoAlpha: 1,
            ease: "none",
            scrollTrigger: {
              trigger: frame,
              start: "top bottom",
              end: "top 22%",
              scrub: SCRUB.parallax,
            },
          },
        );
      });

      /*
       * Parallax on the devices, and deliberately barely any.
       *
       * A phone drifting 4% of its own height against the column beside it is
       * enough to stop the page reading as one flat plane, which is the entire
       * ambition. The usual mistake here is a number you can see: at 15% the
       * device visibly slides against its own caption, the pair stops being one
       * object, and a reader spends the section watching a bug.
       *
       * `yPercent` rather than `y`, so it scales with the device instead of
       * being a fixed distance that is subtle at `lg` and comical at `sm`.
       */
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((device) => {
        gsap.fromTo(
          device,
          { yPercent: 4 },
          {
            yPercent: -4,
            ease: "none",
            scrollTrigger: {
              trigger: device,
              start: "top bottom",
              end: "bottom top",
              scrub: SCRUB.parallax,
            },
          },
        );
      });

      /*
       * Anything marked as a run of related rows: the guarantees, the ledger,
       * the two halves of the import and export section. One trigger for the
       * group and a stagger inside it, rather than a trigger each, because a
       * list where every row waits for its own scroll position arrives as a
       * queue instead of as a list.
       */
      gsap.utils.toArray<HTMLElement>("[data-stagger]").forEach((group) => {
        const rows = group.children;
        if (!rows.length) return;

        gsap.fromTo(
          rows,
          { y: 22, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            ease: "power2.out",
            /*
             * The one run here that is not scrubbed, so this pair is a real
             * duration and a real gap. Both grew with everything else: a list
             * that snaps in under a second sitting between two titles that take
             * two thirds of a screen to arrive is the seam the rest of this
             * change exists to remove.
             *
             * `once`, still. A group that re-runs every time it is scrolled
             * back past reads as a page that cannot settle, and the slower it
             * is the more obvious that gets.
             */
            duration: 1.15,
            stagger: 0.13,
            scrollTrigger: { trigger: group, start: "top 88%", once: true },
          },
        );
      });
    });

    return () => {
      for (const revert of cleanup) revert();
      mm.revert();
    };
  }, []);

  return null;
}
