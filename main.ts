// SPDX-License-Identifier: MIT
// RangeHarvest — a range-trading BTC bot for make.fun's
// "Race a BTC trading bot live for 24 hours" (btc-race-24h-20261117-0603).
//
// Original strategy, written from the dev window's own data. The dev window
// (2026-11-16 06:03 UTC -> 2026-11-17 06:03 UTC, 1,440 1-minute cbBTC bars)
// is range-bound: +0.49% start to end, max close-to-close drawdown -2.12%,
// 1-minute return sd ~6.4 bps, while a full-size round trip costs ~26 bps
// (4 bps fee + 2 bps slippage + ~7 bps price impact each way, plus the
// flatten at the end). Fast signals therefore bleed to death on fees — the
// kit's own baselines prove it on this window: ema-cross -106.21 USDC on
// 68 trades, rsi-bollinger -24.25 on 11, adx-momentum -32.66 on 26, while
// buy-and-hold (+1.07, 1 trade) and momentum (+2.45, 1 trade) barely
// profit. The money in this window sits in the multi-hour swings, not in
// the minute noise, so this bot harvests the range and ignores everything
// else:
//
//   - It tracks the rolling 240-bar (4-hour) high and low of cbBTC.
//   - Entry, with the whole cash balance: the close is within 0.5% of the
//     rolling 240-bar low AND the 240-bar range itself is at least 0.5%
//     wide (a flat stretch has no range to harvest, and buying into one
//     only churns). At least 10 bars must have passed since the last exit,
//     so one flat stretch cannot re-trigger the same trade.
//   - Exit, whole position: +1.5% take-profit over entry cost, -1.5% hard
//     stop under it, or the close back within 0.1% of the rolling 240-bar
//     high while the position is at least +0.2% in profit (sell the top
//     of the range, never a fresh buy at a scratch loss).
//   - Long only, one asset, one position at a time, full size.
//
// Parameter sensitivity (offline sweep over the same dev window, same fill
// model as the harness: fee 4 bps, slippage 2 bps, impact 1 + a/D):
//   N in {240, 300} x buy-band in {0.4%, 0.5%, 0.6%} x sell-band 0.1%
//   all land between +11.29 and +16.30 USDC with 5-9 trades and max
//   drawdown ~1.3-1.4% — a plateau, not a single sharp peak. Take-profit
//   and stop-loss barely bind (exits are mostly band sells), so their
//   exact values hardly move the result. Chosen point, mid-plateau:
//   N=240, buy-band 0.5%, sell-band 0.1%, TP/SL 1.5%.
//   OVERFIT WARNING: the profit is concentrated — the first 12 hours make
//   +16.52 USDC (two full range swings) and the second 12 hours lose
//   -7.29 USDC on a single round trip. This is one 24-hour sample; the
//   race window is unseen and may trend instead of ranging. The guards
//   (range-width filter, profit-only band sell, 1.5% stop, 10-bar
//   cooldown) are there to bound the damage if it does: worst case is a
//   few stopped-out entries, not a churn bleed.
//
// Deterministic: integer arithmetic only (bigint price units), no clock,
// no randomness, no network, no files — every decision is a pure
// function of the bars seen, so two executions produce identical orders.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Rolling window, in bars. */
const RANGE_BARS = 240;
/** Buy when the close is within 0.5% of the rolling low: c * 1000 <= lo * 1005. */
const BUY_BAND_NUM = 1005n;
const BUY_BAND_DEN = 1000n;
/** The range must be at least 0.5% wide: hi * 1000 >= lo * 1005. */
const MIN_WIDTH_NUM = 1005n;
const MIN_WIDTH_DEN = 1000n;
/** Sell when the close is within 0.1% of the rolling high: c * 1000 >= hi * 999. */
const SELL_BAND_NUM = 999n;
const SELL_BAND_DEN = 1000n;
/** Take-profit +1.5% over entry cost, hard stop -1.5% under it. */
const TP_NUM = 1015n;
const SL_NUM = 985n;
const PCT_DEN = 1000n;
/** A band sell needs the position at least +0.2% in profit. */
const MIN_PROFIT_NUM = 1002n;
/** Bars to wait after an exit before a new entry. */
const COOLDOWN_BARS = 10;
const MAX_SLIPPAGE_BPS = 100;

const SYMBOL = 'CBBTC';

/** Rolling highs/lows, oldest first, over bars actually seen. */
const highs: bigint[] = [];
const lows: bigint[] = [];
let barsSeen = 0;
let lastExitBar = -1_000_000;

function push(bar: Bar): void {
  highs.push(BigInt(bar.h));
  lows.push(BigInt(bar.l));
  if (highs.length > RANGE_BARS) highs.shift();
  if (lows.length > RANGE_BARS) lows.shift();
  barsSeen += 1;
}

function rollingHigh(): bigint {
  let hi = highs[0];
  for (const h of highs) if (h > hi) hi = h;
  return hi;
}

function rollingLow(): bigint {
  let lo = lows[0];
  for (const l of lows) if (l < lo) lo = l;
  return lo;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) push(bar);
    }
    if (state.warmingUp) return [];
    const fresh = batch.bars.some((b) => b.symbol === SYMBOL);
    if (!fresh || barsSeen < RANGE_BARS) return [];

    const close = state.close(SYMBOL);
    if (close === null) return [];
    const hi = rollingHigh();
    const lo = rollingLow();
    const held = state.positions.get(SYMBOL);
    const { fees } = state.hello;

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const tp = (held.cost * TP_NUM) / PCT_DEN;
      const sl = (held.cost * SL_NUM) / PCT_DEN;
      const bandSell =
        (close * SELL_BAND_DEN >= hi * SELL_BAND_NUM) &&
        value * PCT_DEN >= held.cost * MIN_PROFIT_NUM;
      if (value >= tp || value <= sl || bandSell) {
        lastExitBar = barsSeen;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    if (barsSeen - lastExitBar < COOLDOWN_BARS) return [];
    // No range, no trade: a flat stretch has nothing to harvest.
    if (hi * MIN_WIDTH_DEN < lo * MIN_WIDTH_NUM) return [];
    if (close * BUY_BAND_DEN > lo * BUY_BAND_NUM) return [];

    let slice = state.cash;
    const room = state.weightRoom(SYMBOL);
    if (slice > room) slice = room;
    if (slice < BigInt(fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
