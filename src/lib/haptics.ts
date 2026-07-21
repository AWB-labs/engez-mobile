// Haptic cues for the feedback matrix (DESIGN.md §6). The web client fires
// navigator.vibrate with raw millisecond patterns; native has proper feedback
// generators, so each cue maps onto the closest expo-haptics primitive:
//
//   turn start   10ms        → Light impact
//   exact  (+2)  30ms        → Heavy impact
//   close  (+1)  15ms        → Light impact
//   game won     [30,40,30]  → Success notification + two spaced Medium taps
//
// Everything here is fire-and-forget. Simulators, tablets without a haptic
// engine, and the web target all reject (or throw synchronously when the
// native module is absent) — none of that may ever reach a caller, exactly
// like the web's `if (navigator.vibrate)` guard.

import * as Haptics from 'expo-haptics';

/** Run one haptic call, swallowing both sync throws and async rejections. */
function fire(trigger: () => Promise<void>): void {
  try {
    trigger().catch(() => {});
  } catch {
    // Native module missing — silently skip, haptics are pure garnish.
  }
}

/** The round is live — a light tap under the describer's thumb. */
export function hapticTurnStart(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Host shuffled the teams — a light tap confirming the re-deal landed. */
export function hapticShuffle(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** +2 exact — the heaviest single hit we have; it should feel like a stamp. */
export function hapticExact(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

/** +1 close — lighter than exact, so the hand learns the difference. */
export function hapticClose(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/**
 * Game won — the web pattern is vibrate [30, 40, 30]. Native has no raw
 * pattern API, so: a Success notification for the flourish, then two spaced
 * Medium taps to echo the double-buzz rhythm.
 */
export function hapticWin(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  setTimeout(() => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)), 150);
  setTimeout(() => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)), 300);
}
