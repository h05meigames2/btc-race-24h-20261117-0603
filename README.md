# btc-race-24h-20261117-0603

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/h05meigames2/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/h05meigames2/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

RangeHarvest — a range-trading BTC bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars with $1,000 of paper money, long only.

**Strategy:** the dev window (2026-11-16 06:03 UTC → 2026-11-17 06:03 UTC) is range-bound: +0.49% start to end, max drawdown -2.12%, 1-minute return sd ~6.4 bps, while a full-size round trip costs ~26 bps in fee, slippage and price impact. Fast signals bleed to death on fees — on this window the kit's own baselines score ema-cross -106.21 USDC (68 trades), rsi-bollinger -24.25 (11), adx-momentum -32.66 (26), while buy-and-hold makes +1.07 (1 trade). So this bot harvests the multi-hour range and ignores the minute noise: it buys with all cash when the close is within 0.5% of the rolling 240-bar (4-hour) low while that range is at least 0.5% wide, and sells the whole position at +1.5% take-profit, -1.5% hard stop, or back within 0.1% of the rolling 240-bar high while at least +0.2% in profit. A 10-bar cooldown after each exit stops one flat stretch from re-triggering the same trade. Deterministic: integer arithmetic only, no clock, no randomness, no network — every decision is a pure function of the bars seen.

**Dev window result (grade-local, kit's frozen 24h window):** net PnL **+14.57 USDC** (+1.46%), 7 trades, win rate 75%, max drawdown 1.37%, fees 3.25 USDC, 0 rejected orders, guardrails met, two executions byte-for-byte identical (L1 regrade reproduced).

**Overfit warning:** the profit is concentrated — the first 12 hours make +16.52 USDC and the second 12 hours lose -7.29 USDC on a single round trip. The parameter neighbourhood is a plateau, not a sharp peak (N 240–300 × buy-band 0.4–0.6% × sell-band 0.1% all score +11.29 to +16.30 USDC), but this is still one 24-hour sample and the unseen race window may trend instead of ranging; the range-width filter, profit-only band sell, 1.5% stop and cooldown bound the damage if it does.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0ene8b3q&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
