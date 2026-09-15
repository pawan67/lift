/**
 * The volume advisor, in the two halves it is built from.
 *
 * `advice` arrives from the database and is complete on its own: gaps, ranked,
 * with every figure measured. It never waits on a network and it does not care
 * whether the AI coach is switched on.
 *
 * `prescription` is the sentence a model adds on top, and it is only ever
 * fetched when somebody asks for it. Keeping the two in one hook rather than two
 * is what stops a screen accidentally rendering the second without the first: a
 * prescription with no figures above it is advice from nowhere.
 */

import {
  ADVICE_BRIEF,
  buildRoutineSection,
  describeVolumeGaps,
  MUSCLE_GROUP_LABELS,
  type VolumeGap,
} from '@lift/shared';
import { useCallback, useMemo, useRef, useState } from 'react';

import { requireAiConfig, streamCompletion } from './client';
import { AiError } from './errors';
import { getVolumeAdvice, hasEnoughData, type VolumeAdvice } from './volume-advice';
import { buildCoachReport } from '@/features/coach/report';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';

/**
 * How much the prescription is allowed to write.
 *
 * One or two sentences per muscle, and the list is capped below, so this is
 * generous rather than tight. It exists to bound a runaway answer, not to shape
 * a good one; the brief does the shaping.
 */
const MAX_OUTPUT_TOKENS = 700;

/**
 * The worst four, and no more.
 *
 * A prescription for eleven muscles is a training programme, and this card is
 * not the place to be handed one. Four is what fits on a phone without
 * scrolling and is more change than anybody should make in one week anyway.
 */
const MAX_PRESCRIBED = 4;

/** One shared empty array, so "no gaps" is a stable identity. */
const EMPTY: VolumeGap[] = [];

export interface UseVolumeAdvice {
  advice: VolumeAdvice | null;
  /** Enough logged in the window for the figures to mean anything. */
  ready: boolean;
  gaps: VolumeGap[];
  prescription: string | null;
  pending: boolean;
  error: AiError | null;
  ask: () => void;
}

export function useVolumeAdvice(): UseVolumeAdvice {
  const [advice, setAdvice] = useState<VolumeAdvice | null>(null);
  const [prescription, setPrescription] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);

  const abort = useRef<AbortController | null>(null);

  // Deferred, like every other analytics read on a tab screen: this is a scan
  // over four weeks of sets and it must not run inside the transition that
  // brought the user here.
  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      // A failed read leaves the card absent rather than the screen broken. It
      // is a card on a dashboard, and nothing below it depends on it.
      void getVolumeAdvice()
        .then((next) => {
          if (!cancelled) setAdvice(next);
        })
        .catch(() => {});

      return () => {
        cancelled = true;
        // Leaving the screen stops the stream. A half-written prescription is
        // not worth the tokens still being spent on it behind a closed screen.
        abort.current?.abort();
        abort.current = null;
      };
    }, []),
  );

  // Memoised so the empty-case fallback is one array rather than a new one per
  // render. `ask` closes over this, and a fresh identity every pass would make
  // the callback unstable and re-run every effect keyed on it.
  const gaps = useMemo(() => advice?.gaps ?? EMPTY, [advice]);
  const ready = advice !== null && hasEnoughData(advice);

  const ask = useCallback(() => {
    const targets = gaps.slice(0, MAX_PRESCRIBED);
    if (targets.length === 0 || pending) return;

    const controller = new AbortController();
    abort.current = controller;

    setPending(true);
    setError(null);
    setPrescription('');

    void (async () => {
      try {
        const config = await requireAiConfig();

        // Routines only. The model is told what the numbers are and asked where
        // to put the sets, so the sessions, records and measurements the full
        // review carries would be paid for and not read.
        const report = await buildCoachReport({
          range: '30d',
          includeSessions: false,
          includeRoutines: true,
          note: null,
        });

        const document = [
          describeVolumeGaps(targets, MUSCLE_GROUP_LABELS),
          '',
          buildRoutineSection(report),
        ].join('\n');

        await streamCompletion(
          config,
          {
            system: ADVICE_BRIEF,
            messages: [{ role: 'user', content: document }],
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
          {
            onDelta: (text) => setPrescription((current) => (current ?? '') + text),
            signal: controller.signal,
          },
        );
      } catch (cause) {
        const failure = cause instanceof AiError ? cause : new AiError('bad-response');
        if (failure.kind !== 'aborted') {
          setError(failure);
          // Clearing it means a failed attempt leaves the measured half on
          // screen rather than a stub sentence under a "suggested" heading.
          setPrescription(null);
        }
      } finally {
        setPending(false);
        if (abort.current === controller) abort.current = null;
      }
    })();
  }, [gaps, pending]);

  return { advice, ready, gaps, prescription, pending, error, ask };
}
