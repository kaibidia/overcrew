import { describe, it, expect } from "vitest";
import {
  DEMO_SLIDER_TASK,
  isSliderValueAccepted,
  sliderTaskRange,
  formatSliderTask,
  SLIDER_MIN,
  SLIDER_MAX,
  type SliderTask,
} from "./index";

const accepts = (task: SliderTask, values: number[]) =>
  values.map((v) => isSliderValueAccepted(v, task));

describe("slider physical range", () => {
  it("is the integers 0..100", () => {
    expect(SLIDER_MIN).toBe(0);
    expect(SLIDER_MAX).toBe(100);
  });
});

describe("sliderTaskRange", () => {
  it("is target ± tolerance, inclusive", () => {
    expect(sliderTaskRange({ targetValue: 67, tolerance: 3 })).toEqual({
      lo: 64,
      hi: 70,
    });
  });

  it("clamps the upper bound at 100", () => {
    expect(sliderTaskRange({ targetValue: 97, tolerance: 5 })).toEqual({
      lo: 92,
      hi: 100,
    });
  });

  it("clamps the lower bound at 0", () => {
    expect(sliderTaskRange({ targetValue: 2, tolerance: 5 })).toEqual({
      lo: 0,
      hi: 7,
    });
  });

  it("tolerance 0 is a single exact value", () => {
    expect(sliderTaskRange({ targetValue: 41, tolerance: 0 })).toEqual({
      lo: 41,
      hi: 41,
    });
  });
});

describe("isSliderValueAccepted — 67 ± 3", () => {
  const task = { targetValue: 67, tolerance: 3 };
  it("rejects just below and accepts the inclusive lower boundary", () => {
    expect(accepts(task, [63, 64])).toEqual([false, true]);
  });
  it("accepts the target and the inclusive upper boundary, rejects just above", () => {
    expect(accepts(task, [67, 70, 71])).toEqual([true, true, false]);
  });
});

describe("isSliderValueAccepted — 97 ± 5 (upper clamp)", () => {
  const task = { targetValue: 97, tolerance: 5 };
  it("rejects 91, accepts 92..100", () => {
    expect(accepts(task, [91, 92, 100])).toEqual([false, true, true]);
  });
  it("does not accept impossible values above 100", () => {
    expect(isSliderValueAccepted(101, task)).toBe(false);
  });
});

describe("isSliderValueAccepted — exact (± 0)", () => {
  const task = { targetValue: 41, tolerance: 0 };
  it("accepts only 41", () => {
    expect(accepts(task, [40, 41, 42])).toEqual([false, true, false]);
  });
});

describe("isSliderValueAccepted — 50 ± 10 and 0 ± 3 (lower clamp)", () => {
  it("50 ± 10 accepts 40..60 inclusive", () => {
    expect(accepts({ targetValue: 50, tolerance: 10 }, [39, 40, 60, 61])).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
  it("0 ± 3 accepts 0..3 and never a negative", () => {
    const task = { targetValue: 0, tolerance: 3 };
    expect(sliderTaskRange(task).lo).toBe(0);
    expect(accepts(task, [0, 3, 4])).toEqual([true, true, false]);
  });
});

describe("formatSliderTask & demo task", () => {
  it("renders the instruction text", () => {
    expect(formatSliderTask("ДАВЛЕНИЕ", { targetValue: 67, tolerance: 3 })).toBe(
      "ДАВЛЕНИЕ → 67 ± 3",
    );
  });
  it("DEMO_SLIDER_TASK is 67 ± 3 → 64..70", () => {
    expect(DEMO_SLIDER_TASK).toEqual({ targetValue: 67, tolerance: 3 });
    expect(sliderTaskRange(DEMO_SLIDER_TASK)).toEqual({ lo: 64, hi: 70 });
  });
});
