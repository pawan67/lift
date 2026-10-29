/**
 * How much of a view the software keyboard is covering, and whether it is up.
 *
 * `softwareKeyboardLayoutMode: "resize"` is supposed to make this unnecessary on
 * Android: the window shrinks and anything pinned to its bottom rides up with
 * the keyboard. It does not hold on every phone. With the edge-to-edge layout
 * newer Android versions enforce, the window keeps its full height and the
 * keyboard is drawn over the bottom of it, which is how the exercise picker's
 * Add button ended up underneath it.
 *
 * So the overlap is measured rather than assumed. The keyboard reports where its
 * top edge is; the view reports where its bottom edge is; the difference is what
 * is hidden. On a phone that does resize, the view's bottom already sits on the
 * keyboard and the answer is 0, so nothing is lifted twice.
 *
 * Plain `Keyboard` listeners rather than Reanimated's `useAnimatedKeyboard`: that
 * hook takes over the window's insets on Android for as long as it is mounted,
 * which would change the layout of every other screen (see `rest-timer-bar`).
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform, type KeyboardEvent, type View } from 'react-native';

export interface KeyboardOverlap {
  /** True while the keyboard is on screen, whether or not it covers anything. */
  visible: boolean;
  /** Points of the measured view that sit behind the keyboard. */
  overlap: number;
}

const HIDDEN: KeyboardOverlap = { visible: false, overlap: 0 };

export function useKeyboardOverlap(target: RefObject<View | null>): KeyboardOverlap {
  const [state, setState] = useState<KeyboardOverlap>(HIDDEN);
  // The latest event, so a measurement that resolves after a newer one does
  // not overwrite it.
  const generation = useRef(0);

  useEffect(() => {
    // iOS announces the keyboard before it moves, Android only once it has.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      const run = ++generation.current;
      const keyboardTop = event.endCoordinates.screenY;

      const view = target.current;
      if (!view) {
        setState({ visible: true, overlap: 0 });
        return;
      }

      view.measureInWindow((_x, y, _width, height) => {
        if (run !== generation.current) return;
        setState({ visible: true, overlap: Math.max(0, Math.round(y + height - keyboardTop)) });
      });
    };

    const onHide = () => {
      generation.current += 1;
      setState(HIDDEN);
    };

    const shown = Keyboard.addListener(showEvent, onShow);
    const hidden = Keyboard.addListener(hideEvent, onHide);

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [target]);

  return state;
}
