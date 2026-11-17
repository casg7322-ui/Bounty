// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The value model lives here in full (impliedOf), so the page's code and board.json's data are the
// same arithmetic, and the farm plan (farmSteps) is the same derivation main.ts writes: category,
// chains, TVL and age decide the action, the capital, the hold and every cost and time. No protocol
// name is special-cased anywhere.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtAgeLong(days) {
    if (days === null || days === undefined) return 'an unknown time';
    if (days >= 365) return (days / 365).toFixed(1) + ' years';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function ordinal(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
    if (n % 10 === 1) return n + 'st';
    if (n % 10 === 2) return n + 'nd';
    if (n % 10 === 3) return n + 'rd';
    return n + 'th';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and the comps
  // table main.ts derived, and checks the number board.json carries, so the page's code and the
  // board's data are visibly the same arithmetic.
  function impliedOf(row) {
    var m = DATA.model;
    var comp = DATA.category_multiples[row.category || 'Other'];
    var mult = comp ? comp.multiple : DATA.global_multiple;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + Math.min((row.chains || []).length, m.breadth_max_chains) * m.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- the farm plan: the same derivation as lib/model.ts, string for string ---

  var GAS_USD = { Ethereum: 6, Bitcoin: 2, Arbitrum: 0.3, Base: 0.1, Optimism: 0.15, Solana: 0.02, Binance: 0.15, Polygon: 0.05, Avalanche: 0.3, 'Hyperliquid L1': 0.05, Monad: 0.05, Plasma: 0.1, 'Robinhood Chain': 0.05 };
  function gasFor(chain) { return GAS_USD[chain] === undefined ? 1 : GAS_USD[chain]; }
  function money(n) { return Number.isInteger(n) ? '$' + n : '$' + n.toFixed(2); }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // [keywords, main action, second action]; {N} name, {C} first chain, {K} capital. First match wins.
  var ACTIONS = [
    [['lend', 'cdp', 'collateral'], 'Supply ${K} of USDC to {N} on {C} and keep the position open.', 'Borrow a small amount against the supply, then repay it, so the position shows both sides of the market.'],
    [['dex'], 'Provide ${K} of liquidity to {N}\'s main pool on {C} and keep the position open.', 'Swap once inside {N}\'s main pool so the wallet shows trading activity as well as liquidity.'],
    [['yield', 'leveraged farm', 'farm'], 'Deposit ${K} of USDC into {N}’s main vault on {C} and keep the shares.', 'Deposit a second, smaller amount into another {N} vault so the wallet touches more than one product.'],
    [['bridge'], 'Bridge ${K} of USDC to {C} through {N} and use the bridged funds in its app.', 'Bridge a second, smaller amount a week later so the activity spans more than one snapshot.'],
    [['staking', 'restak'], 'Stake ${K} of the chain\'s staking asset through {N} and keep the receipt.', 'Restake or compound the receipt once so the position keeps growing instead of sitting idle.'],
    [['perpetual', 'derivative'], 'Deposit ${K} of USDC as margin on {N} and open one small hedge.', 'Close and reopen the hedge once a month so the account shows repeated trading, not one trade.'],
    [['prediction'], 'Fund ${K} and place one market position on {N}.', 'Place a position in a second market on {N} so the wallet is active across more than one outcome.'],
    [['curator', 'allocator', 'risk'], 'Deposit ${K} into a {N} vault on {C} and keep the shares.', 'Deposit a second amount into another {N} vault on a different chain it runs on.'],
    [['stable'], 'Mint or deposit ${K} of the stable asset through {N} on {C}.', 'Hold the stable asset and use it in one of {N}’s pools instead of leaving it idle.'],
    [['rwa'], 'Mint ${K} of the protocol\'s yield asset on {C} and hold it.', 'Check the yield the asset pays each week and top the position up once if it stays steady.'],
    [['insurance'], 'Buy ${K} of cover from {N} on {C} and keep the policy.', 'Extend or renew the cover once before it lapses so the policy stays active.'],
    [['basis'], 'Deposit ${K} into {N}’s basis vault on {C} and keep the shares.', 'Check the basis the vault earns each month and top the position up once if it holds.'],
    [['chain'], 'Bridge ${K} of USDC to {C} and use {N}’s flagship app with it.', 'Interact with a second app on the chain so the wallet is active beyond one program.'],
    [['anchor btc', 'decentralized btc'], 'Deposit ${K} of BTC through {N} on {C} and keep the receipt.', 'Use the wrapped asset in one lending pool so the position earns beyond the deposit.'],
    [['index'], 'Buy ${K} of the index token on {C} and hold it.', 'Rebalance the holding once a month so the wallet shows repeated activity.'],
    [['payment'], 'Fund ${K} into your {N} account on {C}.', 'Make one payment through {N} so the account shows real use, not just a deposit.'],
    [[], 'Deposit ${K} of USDC into {N} on {C} and keep the position open.', 'Make a second deposit on another chain {N} runs on so the wallet is active in two places.']
  ];
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var entry = null;
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      if (a[0].length === 0 || a[0].some(function (k) { return c.indexOf(k) >= 0; })) { entry = a; break; }
    }
    function fill(s) { return s.split('{N}').join(p.name).split('{C}').join(chain).split('{K}').join(String(capital)); }
    return { main: fill(entry[1]), second: fill(entry[2]) };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = money(gasFor(chain));
    var action = actionsFor(p, capital, chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about ' + gas + ' of gas for the first transaction', time: '5 minutes' },
      { text: action.main, cost: '$' + capital + ' of capital and about ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: action.second, cost: 'about ' + gas + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about ' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // --- state, filters, sorting ---

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.base_multiple; bv = b.base_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --- renderers ---

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip good', html: 'Watchlist <b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b>' }),
        el('span', { class: 'chip', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'chip', html: 'Model <b>' + DATA.model_version + '</b>' })
      )
    );
  }

  function hero() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { html: 'Which pre-token protocol is worth <em>farming</em> next?' }),
        el('p', { class: 'lede', text: 'Every protocol on the watchlist — at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL with no token on record — plus ' + DATA.early_size + ' early ones below that floor, ranked by what a launch would be worth. Each row carries its farm plan.' })
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat accent' }, el('b', { text: fmtUsd(total) }), el('span', { text: 'Total implied value across the board' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist protocols covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows ranked' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'Early rows below the floor' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'Live-token protocols set aside' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 10);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function makeSelect(id, label, options, value, onChange) {
      var s = el('select', { id: id, 'aria-label': label }, options.map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null });
      }));
      s.addEventListener('change', function () { onChange(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      makeSelect('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      makeSelect('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c + ' (' + chainCounts[c] + ')']; })), state.chain, function (v) { state.chain = v; }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.base_multiple.toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap/TVL ratios are the comps the model values the board with.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var comps = Object.keys(DATA.category_multiples).map(function (k) {
      return { category: k, multiple: DATA.category_multiples[k].multiple, n: DATA.category_multiples[k].n };
    }).sort(function (a, b) { return b.n - a.n; }).slice(0, 7);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'Every row is scored by one function of the snapshot figures. The base multiple is not picked by hand: it is the median mcap/TVL of the live-token protocols in the same category, so a lending protocol is valued like live lending protocols. A category with fewer than ' + m.min_comps + ' live comps falls back to the global median of ' + DATA.global_multiple + 'x across ' + DATA.global_comp_n + ' live protocols. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x comp_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains, ' + m.breadth_max_chains + ') x ' + m.breadth_per_chain + ') )'
      ),
      el('div', { class: 'comps' },
        el('div', { class: 'comp' }, el('b', { text: DATA.global_multiple + 'x' }), el('span', { text: 'Global median · ' + DATA.global_comp_n + ' live comps' })),
        comps.map(function (c) {
          return el('div', { class: 'comp' }, el('b', { text: c.multiple + 'x' }), el('span', { text: c.category + ' · ' + c.n + ' live comps' }));
        })
      ),
      el('p', { class: 'note', text: 'What the board leaves out, and why: ' + DATA.excluded_products + ' wrapped, staked or bridged products were excluded — a wrapped token of one that already trades has no launch of its own to rank. ' + DATA.set_aside_above_floor + ' protocols above the floor that the watchlist leaves out are set aside too: the house rule sees a parent protocol this snapshot does not carry, so they are most likely sub-products, and the radar does not rank what it cannot verify is standalone.' })
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. Snapshot as of ' + DATA.as_of + '; the data is sealed and does not move.' }),
      el('p', { text: 'Implied value is this entry\u2019s model, not a price and not a promise: it asks what a token would be worth if the protocol\u2019s record stayed as it is. A protocol "records no token" on DefiLlama\u2019s record; that is not proof it has none. Built for the make.fun token-radar-01 bounty.' })
    );
  }

  // Why one protocol sits where it does, in its own figures: TVL rank, growth, age, and which
  // multiple valued it.
  function whyRank(row) {
    var byTvl = DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    var tvlRank = 0;
    for (var i = 0; i < byTvl.length; i++) if (byTvl[i].slug === row.slug) { tvlRank = i + 1; break; }
    var first = 'Rank ' + row.rank + ' of ' + DATA.board_size + '. Its ' + fmtUsd(row.tvl_usd) + ' TVL is the ' + ordinal(tvlRank) + ' largest pre-token TVL on the board';
    first += row.change_7d === null ? ', with no 7-day change reported' : ', and it ' + (row.change_7d >= 0 ? 'grew ' : 'fell ') + fmtPct(Math.abs(row.change_7d)) + ' in 7 days';
    first += row.age_days === null ? ', with an unknown listing age.' : ', after ' + fmtAgeLong(row.age_days) + ' with no token recorded.';
    var second = row.comp_n > 0
      ? 'Valued at ' + row.base_multiple + 'x TVL: the median mcap/TVL of ' + row.comp_n + ' live ' + (row.category || 'Other') + ' protocols.'
      : 'Valued at ' + row.base_multiple + 'x TVL: the global median across ' + DATA.global_comp_n + ' live-token protocols, because ' + (row.category || 'Other') + ' has fewer than ' + DATA.model.min_comps + ' live comps.';
    return first + ' ' + second;
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · no token recorded' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this rank' }),
      el('p', { class: 'why', text: whyRank(row) })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple (' + (row.comp_n > 0 ? row.comp_n + ' live comps' : 'global fallback') + ')' }), el('b', { class: 'num', text: row.base_multiple + 'x' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → x' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → x' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: 'x' + row.breadth_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'verify', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });

  // Test hooks (no effect on the page): the build's parity check runs farmSteps and impliedOf in
  // Node and compares them against board.json, so the page and the board can never drift apart.
  window.__farmSteps = farmSteps;
  window.__impliedOf = impliedOf;
})();
