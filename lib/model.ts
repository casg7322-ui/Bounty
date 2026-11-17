// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// early radar: every pre-token protocol below the watchlist floor that could plausibly launch a token
// of its own. A protocol is rankable only when it records no token AND is not a wrapped, staked or
// bridged product of one that trades: the watchlist's own exclusion rule (category, versioned name,
// wrapped/staked/staking words, exchange-prefixed name) applies to every row, so the board is never
// topped by WBTC or a staked-ETH product, which have no launch of their own to rank. Protocols above
// the floor that the watchlist leaves out are set aside on purpose: the house's rule sees a
// parentProtocol the snapshot does not carry, so a protocol it left out is most likely a sub-product,
// and the radar does not rank what it cannot verify is standalone.
//
// Implied value follows only from the snapshot's own figures, and the base multiple is derived from
// the snapshot's live-token protocols, not picked by hand:
//
//   compMultiple = median(mcap_usd / tvl_usd) of the live-token protocols in the same category
//                  (at least 2 comps, clamped to [0.05, 1.5]; otherwise the global live median)
//   base         = tvl_usd x compMultiple
//   growth       = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity     = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth      = 1 + min(chains, 8) x 0.02
//   implied      = max(1, round(base x growthMult x maturity x breadth))
//
// The dashboard recomputes every row with the same arithmetic (app.js: impliedOf), so the page and
// board.json always agree. No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  mult_min: number;
  mult_max: number;
  min_comps: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  mult_min: 0.05,
  mult_max: 1.5,
  min_comps: 2,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    comp_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  comp_n: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, derived from the snapshot's live-token protocols. */
export interface CategoryComp {
  multiple: number;
  n: number;
}

/** Everything the dashboard needs: the board, the live set, the comps table, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_above_floor: number;
  excluded_products: number;
  global_multiple: number;
  global_comp_n: number;
  category_multiples: Record<string, CategoryComp>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** A multiple clamped to the model's band, rounded to 4 decimals. */
function clampMult(x: number, model: ModelConstants): number {
  return Math.round(Math.min(model.mult_max, Math.max(model.mult_min, x)) * 1e4) / 1e4;
}

/**
 * The comparable multiples, derived from the snapshot's own live-token protocols: for each category,
 * the median mcap/TVL of its live protocols (kept only with at least min_comps of them), plus the
 * global median across all live protocols as the fallback. Nothing here is a hand-picked number.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Record<string, CategoryComp>; global: number; globalN: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of live) {
    const ratio = p.mcap_usd! / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(ratio);
    byCat.set(key, arr);
  }
  all.sort((a, b) => a - b);
  const global = clampMult(median(all) ?? 0.25, model);
  const byCategory: Record<string, CategoryComp> = {};
  for (const [cat, ratios] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length < model.min_comps) continue;
    ratios.sort((a, b) => a - b);
    byCategory[cat] = { multiple: clampMult(median(ratios)!, model), n: ratios.length };
  }
  return { byCategory, global, globalN: all.length };
}

/** The base multiple one protocol gets: its category's comp median, or the global live median. */
export function baseMultiple(p: SnapshotProtocol, comps: { byCategory: Record<string, CategoryComp>; global: number }): { multiple: number; n: number } {
  const c = comps.byCategory[p.category ?? 'Other'];
  if (c !== undefined) return { multiple: c.multiple, n: c.n };
  return { multiple: comps.global, n: 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  comps: { byCategory: Record<string, CategoryComp>; global: number },
): { implied: number; multiple: number; compN: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, n: compN } = baseMultiple(protocol, comps);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(protocol.chains.length, model.breadth_max_chains) * model.breadth_per_chain;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, multiple, compN, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are wrapped, staked or bridged products of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name are that exchange's product, not a standalone protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking in the name marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is not a launch candidate, or null when it is one. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token, standalone, and plausibly launchable. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comps = categoryComps(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, every one of them.
  // Above the floor, a protocol the watchlist leaves out is set aside: the house's rule sees a
  // parentProtocol this snapshot does not carry, so it is most likely a sub-product, not a launch.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, comps);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_multiple: s.v.multiple,
      comp_n: s.v.compN,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in USD: the farm plan's gas figures come from this table. */
const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Bitcoin: 2,
  Arbitrum: 0.3,
  Base: 0.1,
  Optimism: 0.15,
  Solana: 0.02,
  Binance: 0.15,
  Polygon: 0.05,
  Avalanche: 0.3,
  'Hyperliquid L1': 0.05,
  Monad: 0.05,
  Plasma: 0.1,
  'Robinhood Chain': 0.05,
};

export function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 1;
}

/** A dollar figure as the farm plan writes it: $6, $0.30, $0.02. */
function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The category's two actions: the main position and a second qualifying action. {N} is the protocol's
 * name, {C} its first chain, {K} the capital. The first matching keyword list wins; the last entry is
 * the fallback for a category the table does not name.
 */
const ACTIONS: Array<{ match: string[]; main: string; second: string }> = [
  {
    match: ['lend', 'cdp', 'collateral'],
    main: 'Supply ${K} of USDC to {N} on {C} and keep the position open.',
    second: 'Borrow a small amount against the supply, then repay it, so the position shows both sides of the market.',
  },
  {
    match: ['dex'],
    main: "Provide ${K} of liquidity to {N}'s main pool on {C} and keep the position open.",
    second: "Swap once inside {N}'s main pool so the wallet shows trading activity as well as liquidity.",
  },
  {
    match: ['yield', 'leveraged farm', 'farm'],
    main: 'Deposit ${K} of USDC into {N}\u2019s main vault on {C} and keep the shares.',
    second: 'Deposit a second, smaller amount into another {N} vault so the wallet touches more than one product.',
  },
  {
    match: ['bridge'],
    main: 'Bridge ${K} of USDC to {C} through {N} and use the bridged funds in its app.',
    second: 'Bridge a second, smaller amount a week later so the activity spans more than one snapshot.',
  },
  {
    match: ['staking', 'restak'],
    main: "Stake ${K} of the chain's staking asset through {N} and keep the receipt.",
    second: 'Restake or compound the receipt once so the position keeps growing instead of sitting idle.',
  },
  {
    match: ['perpetual', 'derivative'],
    main: 'Deposit ${K} of USDC as margin on {N} and open one small hedge.',
    second: 'Close and reopen the hedge once a month so the account shows repeated trading, not one trade.',
  },
  {
    match: ['prediction'],
    main: 'Fund ${K} and place one market position on {N}.',
    second: 'Place a position in a second market on {N} so the wallet is active across more than one outcome.',
  },
  {
    match: ['curator', 'allocator', 'risk'],
    main: 'Deposit ${K} into a {N} vault on {C} and keep the shares.',
    second: 'Deposit a second amount into another {N} vault on a different chain it runs on.',
  },
  {
    match: ['stable'],
    main: 'Mint or deposit ${K} of the stable asset through {N} on {C}.',
    second: 'Hold the stable asset and use it in one of {N}\u2019s pools instead of leaving it idle.',
  },
  {
    match: ['rwa'],
    main: "Mint ${K} of the protocol's yield asset on {C} and hold it.",
    second: 'Check the yield the asset pays each week and top the position up once if it stays steady.',
  },
  {
    match: ['insurance'],
    main: 'Buy ${K} of cover from {N} on {C} and keep the policy.',
    second: 'Extend or renew the cover once before it lapses so the policy stays active.',
  },
  {
    match: ['basis'],
    main: 'Deposit ${K} into {N}\u2019s basis vault on {C} and keep the shares.',
    second: 'Check the basis the vault earns each month and top the position up once if it holds.',
  },
  {
    match: ['chain'],
    main: 'Bridge ${K} of USDC to {C} and use {N}\u2019s flagship app with it.',
    second: 'Interact with a second app on the chain so the wallet is active beyond one program.',
  },
  {
    match: ['anchor btc', 'decentralized btc'],
    main: 'Deposit ${K} of BTC through {N} on {C} and keep the receipt.',
    second: 'Use the wrapped asset in one lending pool so the position earns beyond the deposit.',
  },
  {
    match: ['index'],
    main: 'Buy ${K} of the index token on {C} and hold it.',
    second: 'Rebalance the holding once a month so the wallet shows repeated activity.',
  },
  {
    match: ['payment'],
    main: 'Fund ${K} into your {N} account on {C}.',
    second: 'Make one payment through {N} so the account shows real use, not just a deposit.',
  },
  {
    match: [],
    main: 'Deposit ${K} of USDC into {N} on {C} and keep the position open.',
    second: 'Make a second deposit on another chain {N} runs on so the wallet is active in two places.',
  },
];

/** The category's action pair, with {N}, {C} and {K} filled in. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { main: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const entry = ACTIONS.find((a) => a.match.length === 0 || a.match.some((k) => c.includes(k))) ?? ACTIONS[ACTIONS.length - 1]!;
  const fill = (s: string): string => s.replaceAll('{N}', p.name).replaceAll('{C}', chain).replaceAll('{K}', String(capital));
  return { main: fill(entry.main), second: fill(entry.second) };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * app.js carries the same derivation, so the page's plan and board.json's always agree.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = money(gasFor(chain));
  const action = actionsFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action.main,
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: action.second,
      cost: `about ${gas} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    comp_n: row.model.comp_n,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = categoryComps(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const setAside = snapshot.protocols.filter((p) => !watchlist.has(p.slug) && isRankable(p) && p.tvl_usd >= snapshot.floor_usd).length;
  const excluded = snapshot.protocols.filter((p) => isPreToken(p) && exclusionReason(p) !== null).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_above_floor: setAside,
    excluded_products: excluded,
    global_multiple: comps.global,
    global_comp_n: comps.globalN,
    category_multiples: comps.byCategory,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
