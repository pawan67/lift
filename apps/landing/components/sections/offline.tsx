import { KineticHeading } from "@/components/site/kinetic";

/*
 * Set as a page of a manual, not as a grid of cards.
 *
 * This was six equal cells with a number, a heading and a paragraph, which is
 * the single most recognisable shape on the internet and reads as filled-in
 * template whatever the border radius. The claims have not changed; what
 * changed is that they are now prose with run-in heads, flowing down two
 * columns, which is how a specification has been set since long before there
 * were cards to put one in.
 *
 * The run-in head is doing the work a card's heading used to: it is scannable
 * because it is bold and it starts the line, and it costs no box, no rule and
 * no number to be that.
 */
const GUARANTEES = [
  {
    lead: "It works with the network off.",
    body: "Not degraded, not read-only. Nothing is fetched between a rep and its record, so there is no spinner and nothing that can fail.",
  },
  {
    lead: "Force-quitting mid set loses nothing.",
    body: "The session is written down as you go rather than held in memory. Open the app again and it is still running, on the set you were on.",
  },
  {
    lead: "Nothing comes back on its own.",
    body: "Delete a workout on one phone and it stays deleted on the other, however many times the two of them talk.",
  },
  {
    lead: "Kilograms in, pounds out.",
    body: "Switch units whenever you like. It changes what you read, never what was recorded.",
  },
  {
    lead: "Warm-up sets do not count.",
    body: "They stay out of volume, out of your estimated one rep max and out of personal records.",
  },
  {
    lead: "Nothing in here wants your attention.",
    body: "No ads, no upsell, no feed, no streak to protect. It is open source end to end, which is what stops any of that arriving later.",
  },
];

export function Offline() {
  /*
   * `turn`, and a kinetic title. This is the page's thesis: everything above
   * it is what the app does and everything below it follows from where the
   * app keeps things.
   */
  return (
    <section id="offline" className="overflow-x-clip pt-turn">
      <div className="shell">
        <KineticHeading
          top="Local"
          bottom="first"
          lede="It all lives on your phone, and everything on this page follows from that. Six things that come out of it, none of which you have to take on trust."
        />

        <div data-stagger className="mt-16 sm:mt-20 lg:columns-2 lg:gap-20">
          {GUARANTEES.map((item) => (
            <p
              key={item.lead}
              className="mb-9 break-inside-avoid text-[1.0625rem] leading-[1.7] text-fg-2 last:mb-0 sm:text-lg"
            >
              <strong className="font-semibold text-fg">{item.lead}</strong>{" "}
              {item.body}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
