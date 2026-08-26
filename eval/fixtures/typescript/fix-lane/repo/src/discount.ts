// Genuine defect: the percentage discount is applied as an absolute subtraction
// instead of a proportional one, so a 10% discount removes only 10 currency
// units. The fix lane should read this file, judge the finding `real`, and
// propose the corrected proportional calculation.
export const applyDiscount = (amount: number, percent: number): number => {
  // FIXME: percent is a percentage, not an absolute amount to subtract.
  return amount - percent
}
