import Image from "next/image";
import { cva, type VariantProps } from "class-variance-authority";

import frame from "@/assets/galaxy-s25-ultra.png";
import { cn } from "@/lib/utils";
import { type Screen } from "@/lib/screens";

/*
 * A device frame, and it is a real handset now rather than a drawn rectangle.
 *
 * This used to be a generic silhouette on purpose: no camera, no cutout, no
 * brand, on the grounds that the app runs on any Android phone and a frame
 * claiming a particular one would be the only dishonest thing on the page.
 * That argument is not wrong, it was just paying for something the page did
 * not get much back from. A rounded rectangle around a screenshot reads as a
 * screenshot with a border; an actual body, with a bezel and a punch-hole
 * camera and buttons down the side, reads as a phone, and every claim this
 * page makes is about what the app is like in your hand.
 *
 * The honesty cost is smaller than it looks. The capture geometry is 780x1688,
 * an aspect of 0.4621; this glass is 921x1998, or 0.4610. The frame is not
 * standing in for a shape the screenshots are not: it is within a quarter of a
 * percent of the one they were taken at, so `object-cover` crops about half a
 * pixel of height and nothing in any screen shifts.
 *
 * **The artwork is third-party.** It is the Titanium Gray body from the BRIX
 * Templates community Galaxy S25 Ultra mockup set. Settle its terms and add a
 * row to `NOTICE.md` before this page is anything but sideloading's front
 * door, the same way the typeface in `app/layout.tsx` still has to be settled.
 */

/*
 * The screen, measured off the PNG rather than eyeballed: the flat #1c1c1c
 * fill occupies x 28..948 of 984 and y 25..2022 of 2053, so these four are
 * 28/984, 25/2053, 35/984 and 30/2053 as percentages.
 *
 * **Replacing the PNG means re-measuring all four.** They are the one thing
 * tying the markup to the artwork, and being wrong about them does not fail a
 * build, it puts the app half a bezel off centre.
 */
const SCREEN = {
  top: "1.218%",
  right: "3.557%",
  bottom: "1.461%",
  left: "2.846%",
} as const;

/*
 * No radius here and none on the screenshot either. The knocked-out region in
 * the PNG is already a rounded rectangle and everything around it is opaque
 * bezel, so the artwork does the masking: a square-cornered screenshot behind
 * it has its corners covered rather than clipped. Clipping it as well would
 * mean matching a radius in CSS to one baked into a bitmap, and the two would
 * come apart at the first size that did not divide evenly.
 */
const frameBox = cva("relative shrink-0 aspect-[984/2053]", {
  variants: {
    size: {
      /* `xl` has one caller, the hero, and it is the only size that is two
         figures rather than one: a large fraction of the viewport while the
         device is stacked under the headline, and a fixed 272px once there is
         a column of type beside it. Both live on `--phone-xl`. */
      xl: "w-(--phone-xl)",
      lg: "w-(--phone-lg)",
      md: "w-(--phone-md)",
      sm: "w-(--phone-sm)",
    },
  },
  defaultVariants: { size: "md" },
});

interface PhoneProps extends VariantProps<typeof frameBox> {
  screen: Screen;
  className?: string;
  priority?: boolean;
  /** Rendered width hint for the image optimiser, in CSS pixels. */
  sizes?: string;
  /*
   * Marks the frame for the parallax tween in `scroll-motion.tsx`. Passed
   * through rather than turned into a `parallax` boolean, because the thing
   * that reads it is a `querySelectorAll` over the document and a prop that
   * renders an attribute is the honest shape for that.
   */
  "data-parallax"?: boolean | "";
}

/*
 * The body on its own, with whatever goes on the glass left to the caller.
 *
 * Split out for the appearance section, which puts eight screenshots into one
 * frame and switches between them. That could not be a prop on `Phone` without
 * `Phone` growing a second shape it has one caller for, and it must not be a
 * second copy of the frame: the four `SCREEN` numbers are measured off a
 * bitmap, and a page holding two transcriptions of them is a page where one of
 * them is eventually wrong.
 */
export function PhoneFrame({
  size = "md",
  className,
  priority = false,
  sizes = "(max-width: 768px) 60vw, 320px",
  children,
  ...rest
}: VariantProps<typeof frameBox> & {
  className?: string;
  priority?: boolean;
  sizes?: string;
  children: React.ReactNode;
  "data-parallax"?: boolean | "";
}) {
  return (
    <div className={cn(frameBox({ size }), className)} {...rest}>
      {/*
        Behind the frame, not inside it. The screen is a plain absolutely
        positioned box at the measured rect, and what makes it look inset is
        the artwork painted over it.
      */}
      <div className="absolute overflow-hidden bg-ink" style={SCREEN}>
        {children}
      </div>

      {/*
        `aria-hidden` with an empty alt: the frame is a picture of a phone
        wrapped around the picture that carries the information, and a screen
        reader announcing a second image here would be announcing the border.
        Loaded at the same priority as the screen it sits on, because the two
        arriving apart is a screenshot floating with no body for a frame.
      */}
      <Image
        src={frame}
        alt=""
        aria-hidden
        fill
        sizes={sizes}
        priority={priority}
        quality={88}
        className="pointer-events-none select-none"
      />
    </div>
  );
}

export function Phone({
  screen,
  size = "md",
  className,
  priority = false,
  sizes = "(max-width: 768px) 60vw, 320px",
  ...rest
}: PhoneProps) {
  return (
    <PhoneFrame
      size={size}
      className={className}
      priority={priority}
      sizes={sizes}
      {...rest}
    >
      <Image
        src={screen.src}
        alt={screen.alt}
        fill
        sizes={sizes}
        priority={priority}
        quality={88}
        className="object-cover"
      />
    </PhoneFrame>
  );
}
