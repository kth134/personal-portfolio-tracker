// src/lib/rebalancing-logic.ts

/**
 * Shared logic for calculating rebalancing actions.
 * Used by both the API (server-side) and React components (client-side) for instant updates.
 */
export function calculateRebalanceActions(params: {
  currentValue: number;
  totalPortfolioValue: number;
  targetInGroup: number;
  groupTargetRatio: number;
  upsideThreshold?: number;
  downsideThreshold?: number;
  bandMode?: boolean;
}) {
  const { currentValue, totalPortfolioValue, targetInGroup, groupTargetRatio, upsideThreshold = 5, downsideThreshold = 5, bandMode = false } = params;

  // 1. Implied Overall Target % (e.g. 50% Bonds * 10% TLT in Bonds = 5% Overall)
  const impliedOverallTarget = (groupTargetRatio * targetInGroup) / 100;
  
  // 2. Current Percent within the Group (e.g. TLT's value / total Bonds value)
  // Note: For 'Assets' lens, group value = total value.
  const groupValue = (totalPortfolioValue * groupTargetRatio) / 100;
  const currentInGroupPct = groupValue > 0 ? (currentValue / groupValue) * 100 : 0;

  // 3. Drift within the group (Relative to target)
  const driftPercentage = targetInGroup > 0 ? ((currentInGroupPct - targetInGroup) / targetInGroup) * 100 : 0;

  // 4. Determine Action based on thresholds
  let action: 'buy' | 'sell' | 'hold' = 'hold';
  if (driftPercentage >= Math.abs(upsideThreshold)) action = 'sell';
  else if (driftPercentage <= -Math.abs(downsideThreshold)) action = 'buy';

  // 5. Calculate Transaction Amount
  let amount = 0;
  if (action !== 'hold') {
    if (bandMode) {
      // Conservative: return to threshold edge
      const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold;
      const targetWeightInRange = targetInGroup * (1 + targetDrift / 100);
      const targetValueInRange = (groupValue * targetWeightInRange) / 100;
      amount = Math.abs(targetValueInRange - currentValue);
    } else {
      // Absolute: return to exact target
      const targetValueAbsolute = (groupValue * targetInGroup) / 100;
      amount = Math.abs(targetValueAbsolute - currentValue);
    }
  }

  return {
    impliedOverallTarget,
    currentInGroupPct,
    driftPercentage,
    action,
    amount
  };
}
