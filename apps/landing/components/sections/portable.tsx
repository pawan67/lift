import { ChapterHeading } from "@/components/site/chapter";
import { Reveal } from "@/components/site/reveal";

/*
 * Two doors, so two columns, and the headline sits between them rather than
 * above the pair.
 *
 * No devices here any more. The import and export screens are both a list of
 * what a file holds, which is the one kind of screen a 232px phone frame turns
 * into grey lines: they were the two shots on the page you had to already know
 * to read. Set as text under a rule each, the pair still says what it was
 * there to say, which is that in and out were built at the same time and
 * neither is the afterthought.
 */
const HALVES = [
  {
    title: "Moving in",
    body: "Point it at a Hevy CSV, a Lyfta export, a backup from another phone, or any CSV with a date, an exercise and a set in it. Importing the same file twice adds nothing the second time.",
  },
  {
    title: "Moving out",
    body: "One file holding every workout, set, routine, record and measurement on the phone. There is a row-per-set spreadsheet export as well.",
  },
];

export function Portable() {
  /*
   * `close`. Getting the data out is the same argument as keeping it on the
   * phone, carried one step further, so it sits tight under it.
   */
  return (
    <section className="overflow-x-clip pt-close">
      <div className="shell">
        <ChapterHeading
          title="Out the door"
          lede="Years of training history is not a thing to hand over on the assumption it stays available. Both doors are open, and they were built at the same time."
        />

        <div className="mt-14 grid gap-12 sm:mt-16 md:grid-cols-2 md:gap-12 lg:gap-20">
          {HALVES.map((half, i) => (
            <Reveal
              key={half.title}
              delay={i * 140}
              className="border-t border-line pt-8"
            >
              <h3 className="display-tight text-[clamp(1.75rem,3.2vw,2.5rem)]">
                {half.title}
              </h3>
              <p className="mt-4 max-w-[48ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
                {half.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
