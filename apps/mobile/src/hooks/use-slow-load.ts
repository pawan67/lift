/**
 * True once something has been loading for longer than a person will wait
 * without wondering.
 *
 * This exists to make placeholders honest. A screen that swaps in a skeleton
 * the instant it mounts shows two layouts for every load: the skeleton for two
 * frames and then the real thing, which reads as a flicker rather than as
 * progress, and it is the *fast* devices that get it worst. Holding the frame
 * blank instead is the other failure: correct at 40ms and a void at 400.
 *
 * Both are the same mistake, which is treating "loading" as one state when it
 * is two. Under the threshold the load is imperceptible and the right thing to
 * draw is nothing, because whatever is drawn will be gone before it is read.
 * Over it the wait is felt and the screen owes the reader an account of itself.
 *
 * ## The number
 *
 * 120ms by default, which is about where a delay stops reading as the
 * interface being fast and starts reading as the interface having gone quiet.
 * Well under the ~1s where attention breaks, and far enough above a frame that
 * a local query on a good phone never trips it.
 *
 * ```ts
 * const slow = useSlowLoad(stats === null);
 * if (!stats) return slow ? <Skeleton /> : <Blank />;
 * ```
 *
 * The timer restarts whenever `loading` goes false and true again, so a screen
 * that refetches on focus gets a fresh grace period per load rather than
 * staying latched from the first slow one.
 */

import { useEffect, useState } from 'react';

/** Where a wait stops reading as speed and starts reading as silence. */
export const SLOW_LOAD_MS = 120;

export function useSlowLoad(loading: boolean, afterMs: number = SLOW_LOAD_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) return;

    const crossed = setTimeout(() => setSlow(true), afterMs);

    /*
     * The reset lives in the teardown rather than in an early return above.
     *
     * Writing `if (!loading) setSlow(false)` in the effect body is the obvious
     * spelling and it is a cascading render: the effect runs after a commit
     * and schedules another one purely to catch state up with a prop that
     * already said it. Teardown is where "this load is over" actually belongs,
     * and it runs on exactly the transitions that mean it: loading going
     * false, the threshold changing, the screen unmounting.
     *
     * It has to be cleared at all because the flag would otherwise stay
     * latched: one slow fetch and every later load on that screen shows a
     * placeholder from its first frame, which is the flicker this hook exists
     * to prevent.
     */
    return () => {
      clearTimeout(crossed);
      setSlow(false);
    };
  }, [loading, afterMs]);

  return slow;
}
