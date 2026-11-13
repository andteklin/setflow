/**
 * The largest whole size between `min` and `max` for which `fits` holds,
 * found by binary search (a few layouts instead of one per pixel). Returns
 * `min` when nothing fits, so text never vanishes.
 */
export function largestFit(min: number, max: number, fits: (size: number) => boolean): number {
  if (max <= min) return min;
  if (fits(max)) return max;
  let lo = min; // treated as fitting: the floor we never go below
  let hi = max; // known not to fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
