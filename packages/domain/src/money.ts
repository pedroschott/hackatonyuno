/** The largest safe integer in JavaScript, suitable for exact minor-unit math. */
export const MAX_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER;

export function isMinorAmount(value: unknown): value is number {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertMinorAmount(value: unknown, label = 'amount'): asserts value is number {
  if (!isMinorAmount(value)) {
    throw new RangeError(`${label} must be a non-negative safe integer minor amount.`);
  }
}

/** Adds exact integer minor amounts and fails rather than overflowing silently. */
export function sumMinorAmounts(...amounts: readonly number[]): number {
  return amounts.reduce((total, amount, index) => {
    assertMinorAmount(amount, `amounts[${index}]`);

    if (amount > MAX_MINOR_AMOUNT - total) {
      throw new RangeError('The minor amount sum exceeds Number.MAX_SAFE_INTEGER.');
    }

    return total + amount;
  }, 0);
}

export function subtractMinorAmounts(minuend: number, subtrahend: number): number {
  assertMinorAmount(minuend, 'minuend');
  assertMinorAmount(subtrahend, 'subtrahend');

  if (subtrahend > minuend) {
    throw new RangeError('A minor amount cannot become negative.');
  }

  return minuend - subtrahend;
}
