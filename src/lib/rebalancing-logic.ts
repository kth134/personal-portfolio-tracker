// src/lib/rebalancing-logic.ts

/**
 * Shared logic for calculating rebalancing actions.
 */
export function calculateRebalanceActions(params: {
  currentValue: number;
  actualGroupValue: number;
  totalPortfolioValue: number;
  targetInGroup: number;
  groupTargetRatio: number;
  upsideThreshold?: number;
  downsideThreshold?: number;
  bandMode?: boolean;
}) {
  const { currentValue, actualGroupValue, targetInGroup, groupTargetRatio, upsideThreshold = 5, downsideThreshold = 5, bandMode = false } = params;

  // 1. Implied Overall Target % (Target in Group * Group's Target in Portfolio)
  const impliedOverallTarget = (groupTargetRatio * targetInGroup) / 100;
  
  // 2. Current Weight within its specific GROUP (e.g. Asset Value / Sub-Portfolio Total)
  const currentInGroupPct = actualGroupValue > 0 ? (currentValue / actualGroupValue) * 100 : 0;

  // 3. Relative Drift within the group: ((Actual Weight - Target Weight) / Target Weight)
  const driftPercentage = targetInGroup > 0 ? ((currentInGroupPct - targetInGroup) / targetInGroup) * 100 : 0;

  // 4. Determine Action
  let action: 'buy' | 'sell' | 'hold' = 'hold';
  if (driftPercentage >= Math.abs(upsideThreshold)) action = 'sell';
  else if (driftPercentage <= -Math.abs(downsideThreshold)) action = 'buy';

  // 5. Calculate Transaction Amount (to bring current value to target % of ACTUAL group value)
  let amount = 0;
  if (action !== 'hold') {
    if (bandMode) {
      const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold;
      const targetWeightInRange = targetInGroup * (1 + targetDrift / 100);
      const targetValueInRange = (actualGroupValue * targetWeightInRange) / 100;
      amount = Math.abs(targetValueInRange - currentValue);
    } else {
      const targetValueAbsolute = (actualGroupValue * targetInGroup) / 100;
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

/**
 * Portfolio-wide asset-level action calculator.
 *
 * This is used when an asset can appear across multiple sub-portfolios and
 * drift/rebalancing should be computed against the full portfolio target.
 */
export function calculatePortfolioAssetAction(params: {
  currentValue: number;
  totalPortfolioValue: number;
  targetOverallPct: number;
  upsideThreshold?: number;
  downsideThreshold?: number;
  bandMode?: boolean;
}) {
  const {
    currentValue,
    totalPortfolioValue,
    targetOverallPct,
    upsideThreshold = 5,
    downsideThreshold = 5,
    bandMode = false,
  } = params;

  const currentOverallPct = totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0;
  const driftPercentage = targetOverallPct > 0
    ? ((currentOverallPct - targetOverallPct) / targetOverallPct) * 100
    : 0;

  let action: 'buy' | 'sell' | 'hold' = 'hold';
  if (driftPercentage >= Math.abs(upsideThreshold)) action = 'sell';
  else if (driftPercentage <= -Math.abs(downsideThreshold)) action = 'buy';

  let amount = 0;
  if (action !== 'hold') {
    if (bandMode) {
      const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold;
      const targetWeightInRange = targetOverallPct * (1 + targetDrift / 100);
      const targetValueInRange = (totalPortfolioValue * targetWeightInRange) / 100;
      amount = Math.abs(targetValueInRange - currentValue);
    } else {
      const absoluteTargetValue = (totalPortfolioValue * targetOverallPct) / 100;
      amount = Math.abs(absoluteTargetValue - currentValue);
    }
  }

  return {
    currentOverallPct,
    driftPercentage,
    action,
    amount,
  };
}
