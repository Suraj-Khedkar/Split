import { splitByWeights, splitEvenly } from './money';
import type { SplitMethod, SplitShare } from '../types';

/**
 * Build the per-person split for an expense.
 *
 * Every method funnels through money.ts helpers so the shares always sum to
 * exactly `total` - no lost or invented cents, whichever method is used.
 *
 * `inputs` meaning by method:
 *   equal   - ignored
 *   exact   - minor units each person owes
 *   percent - percentage points (should total 100, but is normalised anyway)
 *   shares  - relative weights, e.g. 2 shares vs 1 share
 */
export function buildSplits(
  method: SplitMethod,
  total: number,
  personIds: string[],
  inputs: Record<string, number> = {}
): SplitShare[] {
  if (personIds.length === 0) return [];

  if (method === 'equal') {
    const amounts = splitEvenly(total, personIds.length);
    return personIds.map((personId, i) => ({ personId, amount: amounts[i] }));
  }

  if (method === 'exact') {
    // Trust the user's numbers; validateSplits reports any mismatch rather
    // than silently reshuffling what they typed.
    return personIds.map((personId) => ({
      personId,
      amount: Math.round(inputs[personId] ?? 0),
    }));
  }

  // percent and shares are both just weights.
  const weights = personIds.map((id) => Math.max(0, inputs[id] ?? 0));
  const amounts = splitByWeights(total, weights);
  return personIds.map((personId, i) => ({ personId, amount: amounts[i] }));
}

export interface SplitValidation {
  valid: boolean;
  /** Signed gap between the shares and the total, in minor units. */
  difference: number;
  message: string;
}

/** Exact-amount splits are the only ones a user can get wrong; say so clearly. */
export function validateSplits(
  total: number,
  splits: SplitShare[]
): SplitValidation {
  const sum = splits.reduce((acc, s) => acc + s.amount, 0);
  const difference = total - sum;
  if (difference === 0) {
    return { valid: true, difference: 0, message: '' };
  }
  const verb = difference > 0 ? 'short' : 'over';
  return {
    valid: false,
    difference,
    message: `Splits are ${verb} by ${(Math.abs(difference) / 100).toFixed(2)}`,
  };
}

/** Convenience for the common "one person paid the whole thing" case. */
export function singlePayer(personId: string, amount: number): SplitShare[] {
  return [{ personId, amount }];
}

/**
 * Validate who-paid entries. Multiple payers are allowed (two people split the
 * bill at the counter), but the amounts they put in must add up to the total,
 * otherwise the ledger silently gains or loses money.
 */
export function validatePayers(
  total: number,
  payers: SplitShare[]
): SplitValidation {
  const active = payers.filter((p) => p.amount !== 0);
  if (active.length === 0) {
    return { valid: false, difference: total, message: 'Nobody is marked as paying' };
  }
  const sum = active.reduce((acc, p) => acc + p.amount, 0);
  const difference = total - sum;
  if (difference === 0) return { valid: true, difference: 0, message: '' };
  const verb = difference > 0 ? 'short' : 'over';
  return {
    valid: false,
    difference,
    message: `Payments are ${verb} by ${(Math.abs(difference) / 100).toFixed(2)}`,
  };
}
