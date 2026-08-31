/**
 * Task-model primitives.
 *
 * This is deliberately tiny — Stage 1 only needs to *represent* a slider task
 * (target value + tolerance) and validate a value against it locally. The full
 * task-difficulty model (deadlines, concurrency, synchronized actions, critical
 * events) is later and separate. See docs/GAME_MODEL.md, DECISIONS D23 / D26.
 */

/** Slider physical range. The slider stores integers in [0, 100]. */
export const SLIDER_MIN = 0;
export const SLIDER_MAX = 100;

/**
 * A slider instruction targets an approximate value within a tolerance, not one
 * exact number. `tolerance: 0` means the exact value is required.
 *
 *   ДАВЛЕНИЕ → 67 ± 3   →  64..70 inclusive are valid
 */
export interface SliderTask {
  targetValue: number;
  tolerance: number;
}

/**
 * Inclusive accepted range for a slider task, clamped to the slider's physical
 * range. `97 ± 5` yields `{ lo: 92, hi: 100 }`, not `{ lo: 92, hi: 102 }`.
 */
export function sliderTaskRange(
  task: SliderTask,
  min: number = SLIDER_MIN,
  max: number = SLIDER_MAX,
): { lo: number; hi: number } {
  return {
    lo: Math.max(min, task.targetValue - task.tolerance),
    hi: Math.min(max, task.targetValue + task.tolerance),
  };
}

/**
 * Whether `value` satisfies the task. Equivalent to
 * `Math.abs(value - target) <= tolerance`, additionally clamped to [min, max]
 * and with both boundaries inclusive.
 */
export function isSliderValueAccepted(
  value: number,
  task: SliderTask,
  min: number = SLIDER_MIN,
  max: number = SLIDER_MAX,
): boolean {
  const { lo, hi } = sliderTaskRange(task, min, max);
  return value >= lo && value <= hi;
}

/** Instruction text, e.g. "ДАВЛЕНИЕ → 67 ± 3". */
export function formatSliderTask(label: string, task: SliderTask): string {
  return `${label} → ${task.targetValue} ± ${task.tolerance}`;
}
