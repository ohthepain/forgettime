import { expect, it } from 'vite-plus/test';
import { nextZeroCrossing } from './zero-crossing';
it('searches adjacent sign transitions and exact zeros without leaving the editable range', () => {
  const pcm = Float32Array.of(1, 1, -1, -1, 0, 0, 1, -1);
  expect(nextZeroCrossing(pcm, 2, 1)).toBe(4);
  expect(nextZeroCrossing(pcm, 7, -1)).toBe(4);
  expect(nextZeroCrossing(pcm, 4, 1)).toBe(7);
  expect(nextZeroCrossing(pcm, 2, -1)).toBe(2);
  expect(nextZeroCrossing(pcm, 4, 1, 0, 7)).toBe(4);
  expect(nextZeroCrossing(pcm, 7, -1, 5)).toBe(7);
  expect(nextZeroCrossing(Float32Array.of(0, 1, 1), 2, -1)).toBe(0);
});
