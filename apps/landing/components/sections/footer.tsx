import { Monitor } from "lucide-react";

import { GitHubMark } from "@/components/site/icons";
import { Wordmark } from "@/components/site/mark";
import { links, webAppHost } from "@/lib/site";

/*
 * One row of four, down from three headed columns of ten.
 *
 * Six of the ten were already on the page, deep-linked from the section that
 * makes the claim they settle: the privacy ledger points at the dependency
 * list and the update notes, the self-hosting section points at the deploy
 * guide and the server. A footer that repeats them is not a second chance to
 * find them, it is the same links again under a heading, and three headings
 * over four links each is a sitemap for a repository with one page in it.
 *
 * What is left is the four a reader could not have reached by reading: the
 * repository, the list of builds, and the two licence documents. The web app
 * sits under the repository instead, by address, because it is the product
 * rather than a document about it.
 *
 * `Third-party notices` is not an ordinary link and is not a candidate for the
 * next trim. The app's anatomical artwork and its volume-landmark model derive
 * from LiftShift under AGPL-3.0, and NOTICE.md is where that attribution
 * lives. **Do not drop it.**
 */
const LINKS = [
  { label: "Source", href: links.repo },
  { label: "Releases", href: links.releases },
  { label: "AGPL-3.0", href: links.licence },
  { label: "Third-party notices", href: links.notices },
];

export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="shell py-16">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-end sm:justify-between sm:gap-14">
          <div>
            <Wordmark id="mark-footer" />
            <p className="mt-5 max-w-[40ch] text-[0.9375rem] leading-relaxed text-fg-2">
              A local-first workout tracker. Everything works offline, nothing
              in it is tracked, and an account is optional.
            </p>
            <a
              href={links.repo}
              className="underline-draw mt-6 inline-flex items-center gap-2 text-sm text-fg-2 transition-colors hover:text-volt"
            >
              <GitHubMark className="size-4" />
              github.com/pawan67/lift
            </a>
            <a
              href={links.webApp}
              className="underline-draw mt-3 flex w-fit items-center gap-2 text-sm text-fg-2 transition-colors hover:text-volt"
            >
              <Monitor className="size-4" />
              {webAppHost}
            </a>
          </div>

          {/*
            A row rather than a column, and no heading over it. Four links do
            not need to be filed, and a `Project` label above four things that
            are obviously the project is the sort of scaffolding that makes a
            small site read as a cut-down large one.
          */}
          <nav aria-label="Project">
            <ul className="flex flex-wrap gap-x-7 gap-y-3 sm:justify-end">
              {LINKS.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="underline-draw text-sm text-fg-2 transition-colors hover:text-fg"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
