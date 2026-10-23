import { loadLineups } from './data.js';
import {
  FEE_BUCKETS,
  FIELD_BUCKETS,
  MAX_ENTRY_BUCKETS,
  POOL_BUCKETS,
  appKey,
  applyFilters,
  bestBy,
  exposure,
  groupStats,
  histogram,
  moneyStats,
  mvpTable,
  scoreStats,
  trend,
} from './metrics.js';

const NUMERIC_SORTS = new Set([
  'points', 'optRatio', 'fee', 'salary', 'winnings', 'finish', 'fieldSize', 'maxEntries', 'prizePool',
]);

const state = {
  ready: false,
  lineups: [],
  errors: [],
};

const explorer = { sort: 'points', dir: 'desc', page: 1 };
let showAllPlayers = false;
let filters = defaultFilters();
let chartObjects = [];
let reduceMotion = false;

function defaultFilters() {
  return {
    apps: [],
    dateFrom: '',
    dateTo: '',
    sports: [],
    sites: [],
    formats: [],
    slates: [],
    contestTypes: [],
    contestNames: [],
    feeMin: '',
    feeMax: '',
    feeBuckets: [],
    maxEntryBuckets: [],
    fieldBuckets: [],
    poolBuckets: [],
    usage: 'entered',
    includeBenchInMoney: false,
    player: '',
    mvpOnly: false,
  };
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function fmtPts(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

function fmtPct(ratio) {
  if (ratio == null || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

function fmtRoi(ratio) {
  if (ratio == null || Number.isNaN(ratio)) return '—';
  const rounded = (ratio * 100).toFixed(1);
  if (rounded === '0.0' || rounded === '-0.0') return '0.0%';
  return `${ratio > 0 ? '+' : ''}${rounded}%`;
}

function fmtMoney(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSalary(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function fmtInt(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function fmtDate(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return iso || '—';
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDateShort(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return iso || '—';
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function fmtPool(value) {
  if (value == null) return '';
  if (value >= 1000) {
    const thousands = value / 1000;
    const text = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1);
    return `$${text}k pool`;
  }
  return `${fmtMoney(value)} pool`;
}

function prettyLabel(label) {
  const key = String(label || '').toLowerCase();
  if (key === 'mvp') return 'MVP';
  if (key === 'cpt' || key === 'capt' || key === 'captain') return 'CPT';
  return label;
}

function currentView() {
  const hash = location.hash.replace(/^#\/?/, '').toLowerCase();
  if (hash === 'grok' || hash === 'chatgpt' || hash === 'lineups') return hash;
  return 'overview';
}

function currentLock() {
  const view = currentView();
  if (view === 'grok' || view === 'chatgpt') return view;
  return null;
}

function selection() {
  const appLock = currentLock();
  const base = applyFilters(state.lineups, filters, { skipUsage: true, appLock });
  const view = applyFilters(state.lineups, filters, { appLock });
  return { appLock, base, view };
}

function pickMoney(rows) {
  if (filters.includeBenchInMoney) return rows;
  return rows.filter((row) => row.used);
}

function rowsForApp(rows, name) {
  const key = appKey(name);
  return rows.filter((row) => appKey(row.app) === key);
}

function canonicalAppName(preferred) {
  const key = appKey(preferred);
  const found = state.lineups.find((row) => appKey(row.app) === key);
  return found ? found.app : preferred;
}

function comparisonApps() {
  const names = [];
  const seen = new Set();
  const add = (name) => {
    if (!name) return;
    const key = appKey(name);
    if (seen.has(key)) return;
    if (filters.apps.length && !filters.apps.some((item) => appKey(item) === key)) return;
    seen.add(key);
    names.push(canonicalAppName(name));
  };
  add('Grok');
  add('ChatGPT');
  for (const row of state.lineups) add(row.app);
  return names;
}

function orderedApps(rows) {
  const names = [];
  const seen = new Set();
  const add = (name) => {
    if (!name || seen.has(name)) return;
    if (!rows.some((row) => row.app === name)) return;
    seen.add(name);
    names.push(name);
  };
  for (const name of comparisonApps()) add(name);
  for (const row of rows) add(row.app);
  return names;
}

function uniqueValues(rows, key) {
  const seen = new Set();
  const values = [];
  for (const row of rows) {
    const value = row[key];
    if (value == null || value === '' || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values.sort((a, b) => String(a).localeCompare(String(b)));
}

function contestRank(name) {
  const text = String(name).toLowerCase();
  if (text.includes('single')) return 0;
  const match = text.match(/(\d+)/);
  if (text.includes('max') && match) return 10 + Number(match[1]);
  return 500;
}

function sortContestTypes(list) {
  return [...list].sort((a, b) => contestRank(a) - contestRank(b) || a.localeCompare(b));
}

function styleFor(appName) {
  const key = appKey(appName);
  if (key === 'grok') {
    return { solid: '#7ee7dc', soft: 'rgba(110,168,255,0.35)', a: '#6ea8ff', b: '#3ef0d0' };
  }
  if (key === 'chatgpt') {
    return { solid: '#b6f075', soft: 'rgba(62,224,162,0.35)', a: '#3ee0a2', b: '#d9f99d' };
  }
  let hue = 0;
  for (const char of String(appName)) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return {
    solid: `hsl(${hue} 70% 64%)`,
    soft: `hsl(${hue} 70% 64% / 0.35)`,
    a: `hsl(${hue} 75% 60%)`,
    b: `hsl(${hue} 80% 72%)`,
  };
}

function gradientFor(appName, horizontal) {
  const style = styleFor(appName);
  return (context) => {
    const { chart } = context;
    const area = chart.chartArea;
    if (!area) return style.solid;
    const gradient = horizontal
      ? chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
      : chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
    gradient.addColorStop(0, style.a);
    gradient.addColorStop(1, style.b);
    return gradient;
  };
}

const THEME_KEY = 'dfs-theme';

function themeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function axisStyle() {
  return {
    grid: { color: themeColor('--chart-grid', 'rgba(255,255,255,0.1)') },
    ticks: { color: themeColor('--chart-text', '#b7c6dc'), font: { size: 11 } },
    border: { color: themeColor('--chart-border', 'rgba(255,255,255,0.14)') },
  };
}

function tooltipStyle() {
  return {
    backgroundColor: themeColor('--tooltip-bg', '#101828'),
    borderColor: themeColor('--tooltip-border', 'rgba(184,202,224,0.35)'),
    borderWidth: 1,
    titleColor: themeColor('--tooltip-title', '#f4f7fb'),
    bodyColor: themeColor('--tooltip-body', '#d5e0ee'),
    padding: 10,
  };
}

function updateThemeButton() {
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
}

function applyTheme(theme, persist) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) localStorage.setItem(THEME_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef3f8' : '#070b12');
  updateThemeButton();
  if (state.ready) safeRender();
}

function destroyCharts() {
  for (const chart of chartObjects) {
    try { chart.destroy(); } catch (_error) { /* canvas already gone */ }
  }
  chartObjects = [];
}

function mountChart(id, config) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(id);
  if (!canvas) return;
  try {
    chartObjects.push(new Chart(canvas, config));
  } catch (error) {
    console.error(error);
  }
}

function ensureChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = themeColor('--chart-text', '#b7c6dc');
  Chart.defaults.borderColor = themeColor('--chart-border', 'rgba(255,255,255,0.14)');
  Chart.defaults.font.family = '"Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif';
}

async function boot() {
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  updateThemeButton();
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next, true);
  });
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const followScheme = () => {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (_error) { stored = 'skip'; }
    if (stored) return;
    applyTheme(scheme.matches ? 'dark' : 'light', false);
  };
  if (scheme.addEventListener) scheme.addEventListener('change', followScheme);
  document.querySelector('.views').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    location.hash = button.dataset.view === 'overview' ? '/' : button.dataset.view;
  });
  document.getElementById('reset').addEventListener('click', resetFilters);
  document.getElementById('filter-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('filters-open');
    document.getElementById('filter-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) document.getElementById('filter-panel')?.scrollIntoView({ block: 'nearest' });
  });
  document.getElementById('active-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip || !state.ready) return;
    clearChip(chip.dataset.chip);
    safeRender({ filtersChanged: true });
  });
  document.getElementById('main').addEventListener('click', onMainClick);
  document.addEventListener('click', (event) => {
    const inside = event.target.closest('details.ms');
    document.querySelectorAll('details.ms[open]').forEach((menu) => {
      if (menu !== inside) menu.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('details.ms[open]').forEach((menu) => {
      menu.open = false;
    });
  });
  window.addEventListener('hashchange', () => safeRender());

  try {
    const data = await loadLineups();
    state.lineups = data.lineups;
    state.errors = data.errors;
    state.ready = true;
    ensureChartDefaults();
    mountFilters();
    safeRender();
  } catch (error) {
    document.getElementById('filter-summary').textContent = 'Lineups failed to load.';
    document.getElementById('main').innerHTML = `
      <div class="empty">
        <h2>Could not load the lineup files</h2>
        <p>${esc(error.message)}</p>
      </div>`;
  }
}

function mountFilters() {
  const panel = document.getElementById('filter-panel');
  const apps = appOptions();
  const dates = uniqueValues(state.lineups, 'date');
  const contests = uniqueValues(state.lineups, 'contestName').sort((a, b) => a.localeCompare(b));
  panel.innerHTML = `
    <section class="filter-group" aria-labelledby="group-status">
      <h2 class="group-title" id="group-status">Status &amp; dates</h2>
      <div class="status-grid">
        <div class="control">
          <span class="control-label" id="usage-label">Lineups</span>
          <div class="seg" role="radiogroup" aria-labelledby="usage-label">
            ${usageOption('entered', 'Entered')}
            ${usageOption('bench', 'Not entered')}
            ${usageOption('all', 'All')}
          </div>
        </div>
        <div class="control">
          <label class="control-label" for="f-from">From</label>
          <input type="date" id="f-from" ${dates[0] ? `min="${esc(dates[0])}"` : ''}>
        </div>
        <div class="control">
          <label class="control-label" for="f-to">To</label>
          <input type="date" id="f-to" ${dates.length ? `max="${esc(dates[dates.length - 1])}"` : ''}>
        </div>
      </div>
    </section>
    <section class="filter-group" aria-labelledby="group-contest">
      <h2 class="group-title" id="group-contest">Contest</h2>
      <div class="contest-grid">
        ${multi('App', 'apps', apps)}
        ${multi('Sport', 'sports', uniqueValues(state.lineups, 'sport'))}
        ${multi('Site', 'sites', uniqueValues(state.lineups, 'site'))}
        ${multi('Format', 'formats', uniqueValues(state.lineups, 'format'))}
        ${multi('Slate', 'slates', uniqueValues(state.lineups, 'slate'))}
        ${multi('Contest type', 'contestTypes', sortContestTypes(uniqueValues(state.lineups, 'contestType')))}
        ${multi('Contest name', 'contestNames', contests, { span: true, search: true })}
      </div>
    </section>
    <section class="filter-group" aria-labelledby="group-money">
      <h2 class="group-title" id="group-money">Money</h2>
      <div class="money-stack">
        <div class="control fee-line">
          <span class="control-label" id="fee-label">Entry fee</span>
          <div class="fee-line-controls">
            <div class="fee-chips" role="group" aria-labelledby="fee-label">
              ${FEE_BUCKETS.map((bucket) => `<button type="button" data-fee-bucket="${esc(bucket)}" aria-pressed="false">${esc(bucket)}</button>`).join('')}
            </div>
            <div class="fee-bounds">
              <input id="f-fee-min" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Min $" aria-label="Minimum entry fee">
              <span aria-hidden="true">–</span>
              <input id="f-fee-max" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Max $" aria-label="Maximum entry fee">
            </div>
          </div>
        </div>
        <div class="money-extra">
          ${multi('Max entries', 'maxEntryBuckets', MAX_ENTRY_BUCKETS)}
          ${multi('Field size', 'fieldBuckets', FIELD_BUCKETS)}
          ${multi('Prize pool', 'poolBuckets', POOL_BUCKETS)}
        </div>
        <label class="switch money-switch"><input type="checkbox" id="f-money"> Include unentered in fees, winnings, and ROI</label>
      </div>
    </section>
    <section class="filter-group" aria-labelledby="group-players">
      <h2 class="group-title" id="group-players">Players</h2>
      <div class="players-grid">
        <div class="control">
          <label class="control-label" for="f-player">Player</label>
          <input id="f-player" type="search" placeholder="Search players" autocomplete="off">
        </div>
        <div class="control">
          <span class="control-label" id="mvp-label">Role</span>
          <label class="check-shell"><input type="checkbox" id="f-mvp"> MVP / captain only</label>
        </div>
      </div>
    </section>
  `;
  panel.addEventListener('change', onFilterChange);
  panel.addEventListener('input', onFilterInput);
  panel.addEventListener('click', onFilterClick);
}

function usageOption(value, label) {
  return `<label><input type="radio" name="usage" value="${value}" ${value === 'entered' ? 'checked' : ''}><span>${label}</span></label>`;
}

function appOptions() {
  const found = [];
  const seen = new Set();
  for (const row of state.lineups) {
    const key = row.app.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(row.app);
  }
  for (const name of ['Grok', 'ChatGPT']) {
    if (!seen.has(name.toLowerCase())) found.push(name);
  }
  return found;
}

function multi(label, facet, options, extra = {}) {
  const choices = options.length
    ? options.map((option) => `
        <label class="ms-opt">
          <input type="checkbox" data-facet="${facet}" value="${esc(option)}">
          <span>${esc(option)}</span>
        </label>`).join('')
    : '<p class="ms-empty">No values yet</p>';
  const search = extra.search
    ? '<input type="search" class="ms-search" data-contest-search placeholder="Search contests" aria-label="Search contest names">'
    : '';
  return `
    <div class="control${extra.span ? ' span-2' : ''}" data-facet-control="${facet}">
      <span class="control-label" id="label-${facet}">${esc(label)}</span>
      <details class="ms">
        <summary aria-labelledby="label-${facet}">
          <span class="ms-val" data-ms-for="${facet}">All</span>
          <span class="ms-caret" aria-hidden="true"></span>
        </summary>
        <div class="ms-menu">${search}<div class="ms-options">${choices}</div></div>
      </details>
    </div>`;
}

function onFilterChange(event) {
  const target = event.target;
  if (target.matches('[data-facet]')) {
    const key = target.dataset.facet;
    filters[key] = [...document.querySelectorAll(`[data-facet="${key}"]:checked`)].map((input) => input.value);
    safeRender({ filtersChanged: true });
    return;
  }
  if (target.name === 'usage') {
    filters.usage = target.value;
    safeRender({ filtersChanged: true });
    return;
  }
  if (target.id === 'f-money') {
    filters.includeBenchInMoney = target.checked;
    safeRender({ filtersChanged: true });
    return;
  }
  if (target.id === 'f-mvp') {
    filters.mvpOnly = target.checked;
    safeRender({ filtersChanged: true });
    return;
  }
  if (target.id === 'f-from' || target.id === 'f-to' || target.id === 'f-fee-min' || target.id === 'f-fee-max') {
    readRanges();
    safeRender({ filtersChanged: true });
  }
}

function onFilterInput(event) {
  const target = event.target;
  if (target.matches('[data-contest-search]')) {
    const query = target.value.trim().toLowerCase();
    target.closest('.ms-menu')?.querySelectorAll('.ms-opt').forEach((option) => {
      option.hidden = Boolean(query) && !option.textContent.toLowerCase().includes(query);
    });
    return;
  }
  if (target.id === 'f-player') {
    filters.player = target.value;
    safeRender({ filtersChanged: true });
    return;
  }
  if (target.id === 'f-from' || target.id === 'f-to' || target.id === 'f-fee-min' || target.id === 'f-fee-max') {
    readRanges();
    safeRender({ filtersChanged: true });
  }
}

function onFilterClick(event) {
  const button = event.target.closest('[data-fee-bucket]');
  if (!button) return;
  const bucket = button.dataset.feeBucket;
  if (filters.feeBuckets.includes(bucket)) {
    filters.feeBuckets = filters.feeBuckets.filter((item) => item !== bucket);
  } else {
    filters.feeBuckets = filters.feeBuckets.concat(bucket);
  }
  safeRender({ filtersChanged: true });
}

function readRanges() {
  filters.dateFrom = document.getElementById('f-from').value;
  filters.dateTo = document.getElementById('f-to').value;
  filters.feeMin = document.getElementById('f-fee-min').value;
  filters.feeMax = document.getElementById('f-fee-max').value;
}

function resetFilters() {
  if (!state.ready) return;
  filters = defaultFilters();
  safeRender({ filtersChanged: true });
}

function clearChip(id) {
  if (id === 'usage') filters.usage = 'entered';
  else if (id === 'money') filters.includeBenchInMoney = false;
  else if (id === 'player') {
    filters.player = '';
    filters.mvpOnly = false;
  } else if (id === 'date') {
    filters.dateFrom = '';
    filters.dateTo = '';
  } else if (id === 'feeRange') {
    filters.feeMin = '';
    filters.feeMax = '';
  } else {
    const splitAt = id.indexOf(':');
    const key = id.slice(0, splitAt);
    const value = id.slice(splitAt + 1);
    if (Array.isArray(filters[key])) filters[key] = filters[key].filter((item) => item !== value);
  }
}

function chipModels() {
  const chips = [];
  if (filters.usage !== 'entered') {
    chips.push({ id: 'usage', label: filters.usage === 'bench' ? 'Not entered' : 'All lineups' });
  }
  if (filters.includeBenchInMoney) chips.push({ id: 'money', label: 'Unentered in money' });
  if (filters.dateFrom || filters.dateTo) {
    chips.push({ id: 'date', label: `${filters.dateFrom || '…'} → ${filters.dateTo || '…'}` });
  }
  if (filters.feeMin !== '' || filters.feeMax !== '') {
    chips.push({ id: 'feeRange', label: `Fee ${filters.feeMin || '0'}–${filters.feeMax || '∞'}` });
  }
  if (filters.player) {
    chips.push({
      id: 'player',
      label: `${filters.mvpOnly ? 'MVP' : 'Player'}: ${filters.player}`,
    });
  }
  const facets = [
    ['apps', 'App'],
    ['sports', 'Sport'],
    ['sites', 'Site'],
    ['formats', 'Format'],
    ['slates', 'Slate'],
    ['contestTypes', 'Type'],
    ['contestNames', 'Contest'],
    ['feeBuckets', 'Fee'],
    ['maxEntryBuckets', 'Max'],
    ['fieldBuckets', 'Field'],
    ['poolBuckets', 'Pool'],
  ];
  for (const [key, prefix] of facets) {
    for (const value of filters[key]) chips.push({ id: `${key}:${value}`, label: `${prefix}: ${value}` });
  }
  return chips;
}

function reflectControls() {
  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element && element.value !== value) element.value = value;
  };
  setValue('f-player', filters.player);
  setValue('f-from', filters.dateFrom);
  setValue('f-to', filters.dateTo);
  setValue('f-fee-min', filters.feeMin);
  setValue('f-fee-max', filters.feeMax);
  const mvp = document.getElementById('f-mvp');
  if (mvp) mvp.checked = filters.mvpOnly;
  const money = document.getElementById('f-money');
  if (money) money.checked = filters.includeBenchInMoney;
  document.querySelectorAll('input[name="usage"]').forEach((input) => {
    input.checked = input.value === filters.usage;
  });
  document.querySelectorAll('[data-facet]').forEach((input) => {
    input.checked = (filters[input.dataset.facet] || []).includes(input.value);
  });
  document.querySelectorAll('[data-fee-bucket]').forEach((button) => {
    button.setAttribute('aria-pressed', filters.feeBuckets.includes(button.dataset.feeBucket) ? 'true' : 'false');
  });
  document.querySelectorAll('.ms-val').forEach((element) => {
    const selected = filters[element.dataset.msFor] || [];
    element.textContent = !selected.length ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} selected`;
    element.classList.toggle('is-set', selected.length > 0);
  });
}

function syncAppLock() {
  const lock = currentLock();
  document.querySelectorAll('[data-facet-control="apps"]').forEach((field) => {
    field.hidden = Boolean(lock);
  });
}

function updateSummary(sel) {
  const summary = document.getElementById('filter-summary');
  const entered = sel.base.filter((row) => row.used).length;
  const bench = sel.base.length - entered;
  summary.dataset.shown = String(sel.view.length);
  summary.dataset.entered = String(entered);
  summary.dataset.bench = String(bench);
  const noun = sel.view.length === 1 ? 'lineup' : 'lineups';
  summary.textContent = `Showing ${sel.view.length} ${noun} · ${entered} entered · ${bench} not entered`;
  const chips = chipModels();
  document.getElementById('active-chips').innerHTML = chips.map((chip) => (
    `<button type="button" class="chip" data-chip="${esc(chip.id)}">${esc(chip.label)} <span aria-hidden="true">×</span></button>`
  )).join('');
  const count = document.getElementById('filter-count');
  if (count) {
    count.hidden = chips.length === 0;
    count.textContent = chips.length === 1 ? '1 active filter' : `${chips.length} active filters`;
  }
  const toggle = document.getElementById('filter-toggle');
  toggle.textContent = chips.length ? `Filters · ${chips.length}` : 'Filters';
}

function updateNav(viewName) {
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.dataset.view === viewName) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const titles = { overview: 'Overview', grok: 'Grok', chatgpt: 'ChatGPT', lineups: 'Lineups' };
  document.title = `${titles[viewName]} · DFS Lineup Tracker`;
}

function safeRender(options = {}) {
  if (!state.ready) return;
  if (options.filtersChanged) {
    explorer.page = 1;
    showAllPlayers = false;
  }
  try {
    render();
  } catch (error) {
    console.error(error);
    destroyCharts();
    document.getElementById('main').innerHTML = `<div class="empty"><h2>Something broke while drawing this view</h2><p>${esc(error.message)}</p></div>`;
  }
}

function render() {
  const viewName = currentView();
  const sel = selection();
  updateNav(viewName);
  updateSummary(sel);
  reflectControls();
  syncAppLock();
  destroyCharts();
  const main = document.getElementById('main');
  main.dataset.view = viewName;
  main.innerHTML = viewHtml(viewName, sel);
  buildCharts(viewName, sel);
}

function viewHtml(viewName, sel) {
  if (viewName === 'lineups') return renderExplorer(sel.view);
  if (viewName === 'grok' || viewName === 'chatgpt') return renderApp(viewName, sel);
  return renderOverview(sel);
}

function renderOverview(sel) {
  const apps = comparisonApps();
  const panels = apps.map((name) => appPanel(name, sel)).join('');
  const versus = apps.length > 1 ? '<div class="vs">VS</div>' : '';
  const blurb = compareBlurb(apps, sel.view);
  return `
    <div class="stack">
      <p class="lede">Head-to-head scoring for lineups built with Grok and ChatGPT. Unentered lineups stay out of the money columns unless you include them.</p>
      ${errorBanner()}
      ${resultsBanner(sel.view)}
      <section class="h2h ${apps.length < 2 ? 'single' : ''}">${insertVersus(panels, versus)}</section>
      <p class="callout">${esc(blurb)}</p>
      ${analyticsHtml(sel.view, true)}
    </div>`;
}

function insertVersus(panels, versus) {
  if (!versus) return panels;
  const parts = panels.split('</article>').filter((part) => part.trim());
  return parts.map((part, index) => `${part}</article>${index < parts.length - 1 ? versus : ''}`).join('');
}

function appPanel(name, sel) {
  const key = appKey(name);
  const rows = rowsForApp(sel.view, name);
  const base = rowsForApp(sel.base, name);
  const entered = base.filter((row) => row.used).length;
  const bench = base.length - entered;
  const stats = scoreStats(rows);
  const money = moneyStats(pickMoney(rows));
  const body = rows.length ? denseStats(stats, money) : `<p class="fine">No ${esc(name)} lineups match this filter.</p>`;
  return `
    <article class="panel" data-app-panel="${esc(key)}">
      <div class="panel-head">
        <h2>${esc(name)}</h2>
        <p class="fine">${entered} entered · ${bench} not entered</p>
      </div>
      ${body}
    </article>`;
}

function denseStats(stats, money) {
  return `
    <div class="stats">
      ${stat('Lineups', String(stats.count), 'lineups')}
      ${stat('Avg pts', fmtPts(stats.avg), 'avg')}
      ${stat('Median', fmtPts(stats.median), 'median')}
      ${stat('Best', fmtPts(stats.best), 'best')}
      ${stat('Avg % optimal', fmtPct(stats.avgOpt), 'opt')}
      ${stat('Fees', fmtMoney(money.fees), 'fees')}
      ${stat('ROI', fmtRoi(money.roi), 'roi')}
      ${stat('Cash rate', fmtPct(money.cashRate), 'cash')}
      ${stat('Winnings', fmtMoney(money.winnings), 'winnings')}
    </div>`;
}

function stat(label, value, name) {
  return `<div class="stat"><span class="field-label">${esc(label)}</span><b data-kpi="${esc(name)}">${esc(value)}</b></div>`;
}

function kpi(label, value, name, fine = '', tone = '') {
  return `
    <article class="kpi ${tone}">
      <span class="field-label">${esc(label)}</span>
      <strong data-kpi="${esc(name)}">${esc(value)}</strong>
      ${fine ? `<p class="fine">${esc(fine)}</p>` : ''}
    </article>`;
}

function compareBlurb(apps, rows) {
  if (apps.length < 2) return 'One app is in this filter.';
  const [left, right] = apps;
  const a = scoreStats(rowsForApp(rows, left));
  const b = scoreStats(rowsForApp(rows, right));
  if (!a.count && !b.count) return 'No lineups match this filter.';
  if (!a.count) return `${left} has no lineups in this filter. ${right} is the book.`;
  if (!b.count) return `${left} is in the book. ${right} has no lineups in this filter yet.`;
  if (a.avg == null || b.avg == null) return 'Not enough scores to compare averages.';
  const diff = a.avg - b.avg;
  if (Math.abs(diff) < 0.005) return 'Average scores are level in this filter.';
  const leader = diff > 0 ? left : right;
  const trailer = diff > 0 ? right : left;
  return `${leader} leads ${trailer} by ${Math.abs(diff).toFixed(2)} average points.`;
}

function renderApp(which, sel) {
  const label = which === 'grok' ? 'Grok' : 'ChatGPT';
  const any = state.lineups.some((row) => appKey(row.app) === which);
  if (!any) return emptyApp(which);
  if (!sel.view.length) return emptyFilter();
  const stats = scoreStats(sel.view);
  const money = moneyStats(pickMoney(sel.view));
  const tone = which;
  return `
    <div class="stack">
      ${errorBanner()}
      <header>
        <p class="eyebrow">${esc(label)}</p>
        <p class="page-title">${sel.view.length} lineup${sel.view.length === 1 ? '' : 's'}</p>
      </header>
      ${resultsBanner(sel.view)}
      <section class="kpis" data-app-panel="${which}">
        ${kpi('Lineups', String(stats.count), 'lineups', '', tone)}
        ${kpi('Avg pts', fmtPts(stats.avg), 'avg', '', tone)}
        ${kpi('Median', fmtPts(stats.median), 'median', '', tone)}
        ${kpi('Best', fmtPts(stats.best), 'best', '', tone)}
        ${kpi('Avg % optimal', fmtPct(stats.avgOpt), 'opt', '', tone)}
      </section>
      <section class="kpis money">
        ${kpi('Fees', fmtMoney(money.fees), 'fees', money.feeCount ? `${money.feeCount} with a fee` : '', tone)}
        ${kpi('Winnings', fmtMoney(money.winnings), 'winnings', '', tone)}
        ${kpi('ROI', fmtRoi(money.roi), 'roi', moneyNote(money), tone)}
        ${kpi('Cash rate', fmtPct(money.cashRate), 'cash', money.settled ? `${money.cashed} of ${money.settled} cashed` : 'No settled contests', tone)}
        ${kpi('Top 10%', fmtPct(money.top10Rate), 'top10', money.placed ? `${money.top10} of ${money.placed}` : 'No finish data', tone)}
        ${kpi('Top 1%', fmtPct(money.top1Rate), 'top1', money.placed ? `${money.top1} of ${money.placed}` : 'No finish data', tone)}
      </section>
      ${analyticsHtml(sel.view, false)}
    </div>`;
}

function emptyApp(which) {
  const label = which === 'grok' ? 'Grok' : 'ChatGPT';
  const folder = which === 'grok' ? 'data/grok' : 'data/chatgpt';
  return `
    <div class="empty ${which}" data-app-panel="${which}" data-empty="onboarding">
      <p class="eyebrow">${esc(label)}</p>
      <h2>No ${esc(label)} lineups yet</h2>
      <p>This page uses the same scores, exposure, and results as the other app once a CSV is on the manifest. Lineups you generate and do not enter still belong here: set <code>used</code> to <code>no</code> and they stay out of the money stats.</p>
      <ol>
        <li>Save a CSV under <code>${folder}/</code>.</li>
        <li>Run <code>python3 scripts/build_manifest.py</code>.</li>
        <li>Commit the CSV and <code>data/manifest.json</code>.</li>
      </ol>
    </div>`;
}

function emptyFilter() {
  return `
    <div class="empty" data-empty="filter">
      <h2>No lineups match</h2>
      <p>Nothing in this view fits the filters. Generated lineups you did not submit are hidden while usage is set to Entered.</p>
      <button type="button" class="btn" data-action="reset">Reset filters</button>
    </div>`;
}

function errorBanner() {
  if (!state.errors.length) return '';
  return `<div class="banner">${state.errors.map((error) => esc(error)).join('<br>')}</div>`;
}

function resultsBanner(rows) {
  if (!rows.length) return '';
  const money = moneyStats(pickMoney(rows));
  if (money.settled) return '';
  return `<div class="banner">Results are not in for this filter yet. Cash rate, top finishes, and ROI stay blank until finish, field size, and winnings are filled in. Entry fees still count.</div>`;
}

function moneyNote(money) {
  if (!money.settled) return 'Needs winnings';
  if (money.roiRows < money.rows) return `${money.roiRows} settled`;
  return `${money.roiRows} settled`;
}

function analyticsHtml(rows, compare) {
  if (!rows.length) return emptyFilter();
  const chartNote = typeof Chart === 'undefined'
    ? '<p class="banner">Charts did not load. The tables below still have the numbers.</p>'
    : '';
  return `
    ${chartNote}
    ${mixSection(rows)}
    ${bestSection(rows, compare)}
    <div class="grid-2">
      ${trendCard(rows)}
      ${histCard(rows)}
    </div>
    <div class="grid-2">
      ${contestCard(rows)}
      ${feeCard(rows)}
    </div>
    ${slateCard(rows, compare)}
    ${playerSections(rows, compare)}
  `;
}

function mixSection(rows) {
  const groups = groupStats(rows, pickMoney(rows), (row) => row.contestType);
  if (!groups.length) return '';
  return `
    <section class="card">
      <h2>Contest mix</h2>
      <p class="subhead">Click a contest to filter. Click it again to clear.</p>
      <div class="mix-chips">
        ${groups.map((group) => {
          const active = filters.contestTypes.includes(group.key) ? 'active' : '';
          return `<button type="button" class="${active}" data-contest="${esc(group.key)}" data-set-contest="${esc(group.key)}"><strong data-contest-count>${group.count}</strong><span>${esc(group.key)}</span></button>`;
        }).join('')}
      </div>
    </section>`;
}

function bestSection(rows, compare) {
  const cards = compare
    ? comparisonApps().map((name) => {
        const subset = rowsForApp(rows, name);
        const best = scoreStats(subset).bestRow;
        if (best) return bestCard(best);
        const any = state.lineups.some((row) => appKey(row.app) === appKey(name));
        const detail = any
          ? 'Nothing from this app matches the filter.'
          : `Drop a CSV in data/${appKey(name)} and this card picks up the best score.`;
        return `<article class="best-card quiet"><span class="pill ${appKey(name)}">${esc(name)}</span><h3>No lineup yet</h3><p class="fine">${esc(detail)}</p></article>`;
      })
    : [bestCard(scoreStats(rows).bestRow || null)].filter(Boolean);
  if (!cards.length) return '';
  const single = cards.length < 2 ? ' single' : '';
  return `<section class="card"><h2>${compare ? 'Best lineups' : 'Best lineup'}</h2><div class="best-grid${single}">${cards.join('')}</div></section>`;
}

function bestCard(row) {
  if (!row) return '';
  const optimal = row.optimal != null ? ` (${fmtPts(row.optimal)})` : '';
  return `
    <article class="best-card">
      <div class="best-top">
        <span class="pill ${appKey(row.app)}">${esc(row.app)}</span>
        <span class="fine">${esc(fmtDate(row.date))} · ${esc(row.slate)} · ${esc(row.sport)}</span>
      </div>
      <p class="best-score">${fmtPts(row.points)}<span>pts</span></p>
      <p class="fine">${fmtPct(row.optRatio)} of optimal${esc(optimal)}</p>
      <div class="slots">${row.slots.map((slot) => `<span class="slot${slot.captain ? ' cap' : ''}">${slot.captain ? `${esc(prettyLabel(slot.label))} ` : ''}${esc(slot.name)}</span>`).join('')}</div>
      <p class="best-meta fine">${esc(fmtMoney(row.fee))} · ${esc(row.contestType)} · ${esc(row.contestName)} · salary ${esc(fmtSalary(row.salary))}${row.prizePool != null ? ` · ${esc(fmtPool(row.prizePool))}` : ''}</p>
    </article>`;
}

function trendCard(rows) {
  const dates = new Set(rows.map((row) => row.date).filter(Boolean));
  const subtitle = dates.size < 2
    ? 'One date in this filter. The line fills in as you add slates.'
    : 'Average lineup score by date.';
  return chartCard('chart-trend', 'Trend', subtitle, false);
}

function histCard(rows) {
  const optimals = [...new Set(rows.map((row) => row.optimal).filter((value) => value != null))];
  let subtitle = 'How lineup totals spread.';
  if (optimals.length === 1) subtitle = `How lineup totals spread. Optimal in this filter is ${fmtPts(optimals[0])}.`;
  else if (optimals.length > 1) subtitle = 'How lineup totals spread. Optimals differ across these lineups.';
  return chartCard('chart-hist', 'Distribution', subtitle, false);
}

function chartCard(id, title, subtitle) {
  return `
    <section class="card">
      <h2>${esc(title)}</h2>
      <p class="subhead">${esc(subtitle)}</p>
      <div class="chart-box"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div>
    </section>`;
}

function contestCard(rows) {
  const multi = orderedApps(rows).length > 1;
  const groups = groupStats(rows, pickMoney(rows), (row) => (multi ? `${row.app}\t${row.contestType}` : row.contestType));
  const head = multi
    ? '<tr><th>App</th><th>Type</th><th class="num">Lineups</th><th class="num">Avg</th><th class="num">Best</th><th class="num">% opt</th><th class="num">Fees</th><th class="num">ROI</th></tr>'
    : '<tr><th>Type</th><th class="num">Lineups</th><th class="num">Avg</th><th class="num">Median</th><th class="num">Best</th><th class="num">% opt</th><th class="num">Fees</th><th class="num">ROI</th></tr>';
  const body = groups.map((group) => {
    const parts = String(group.key).split('\t');
    const label = parts.length === 2 ? parts[1] : parts[0];
    const appCell = parts.length === 2 ? `<td><span class="pill ${appKey(parts[0])}">${esc(parts[0])}</span></td>` : '';
    const median = parts.length === 2 ? '' : `<td class="num">${fmtPts(group.median)}</td>`;
    return `<tr>${appCell}<td>${esc(label)}</td><td class="num">${group.count}</td><td class="num">${fmtPts(group.avg)}</td>${median}<td class="num">${fmtPts(group.best)}</td><td class="num">${fmtPct(group.avgOpt)}</td><td class="num">${fmtMoney(group.money.fees)}</td><td class="num">${fmtRoi(group.money.roi)}</td></tr>`;
  }).join('');
  return `
    <section class="card">
      <h2>By contest type</h2>
      <p class="subhead">Average score, and money stats where results exist.</p>
      <div class="chart-box"><canvas id="chart-contest" role="img" aria-label="Average points by contest type"></canvas></div>
      <div class="table-wrap" style="margin-top:14px"><table>${head}<tbody>${body}</tbody></table></div>
    </section>`;
}

function feeCard(rows) {
  const groups = groupStats(rows, pickMoney(rows), (row) => row.feeBucket);
  const order = new Map(FEE_BUCKETS.map((bucket, index) => [bucket, index]));
  groups.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  const body = groups.map((group) => {
    const active = filters.feeBuckets.length === 1 && filters.feeBuckets[0] === group.key ? 'active' : '';
    return `<tr><td><button type="button" class="linkish ${active}" data-set-fee-bucket="${esc(group.key)}">${esc(group.key)}</button></td><td class="num">${group.count}</td><td class="num">${fmtPts(group.avg)}</td><td class="num">${fmtPts(group.best)}</td><td class="num">${fmtMoney(group.money.fees)}</td><td class="num">${fmtRoi(group.money.roi)}</td></tr>`;
  }).join('');
  return `
    <section class="card">
      <h2>By entry fee</h2>
      <p class="subhead">Click a bucket to filter.</p>
      <div class="chart-box"><canvas id="chart-fee" role="img" aria-label="Lineups by entry fee bucket"></canvas></div>
      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>Fee</th><th class="num">Lineups</th><th class="num">Avg</th><th class="num">Best</th><th class="num">Fees</th><th class="num">ROI</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function slateCard(rows, compare) {
  const list = bestBy(rows, (row) => [row.date, row.sport, row.slate, compare ? row.app : ''].join('|'));
  if (!list.length) return '';
  const body = list.map((row) => `
    <tr>
      <td>${esc(fmtDate(row.date))}</td>
      <td><span class="pill ${appKey(row.app)}">${esc(row.app)}</span></td>
      <td>${esc(row.slate)}<div class="fine">${esc(row.sport)} · ${esc(row.site)}</div></td>
      <td class="num">${fmtPts(row.points)}</td>
      <td class="num">${fmtPct(row.optRatio)}</td>
      <td>${esc(row.captain || '—')}</td>
      <td>${esc(row.contestType)}</td>
      <td class="num">${fmtMoney(row.fee)}</td>
    </tr>`).join('');
  return `
    <section class="card">
      <h2>Best lineup per slate</h2>
      <p class="subhead">${compare ? 'Highest score for each app, date, and slate.' : 'Highest score for each date and slate.'}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>App</th><th>Slate</th><th class="num">Pts</th><th class="num">% opt</th><th>Captain</th><th>Contest</th><th class="num">Fee</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function playerSections(rows, compare) {
  const groups = compare
    ? orderedApps(rows).map((app) => ({ app, rows: rows.filter((row) => row.app === app) }))
    : [{ app: rows[0]?.app || 'Lineups', rows }];
  const single = groups.length < 2 ? ' single' : '';
  return `<div class="split${single}">${groups.map((group) => playerBlock(group.app, group.rows)).join('')}</div>`;
}

function playerBlock(appName, rows) {
  const key = appKey(appName);
  const captains = mvpTable(rows);
  const players = exposure(rows);
  const shown = showAllPlayers ? players : players.slice(0, 12);
  const barClass = key === 'chatgpt' ? 'bar chatgpt' : 'bar';
  const captainRows = captains.length
    ? captains.map((row) => `
        <tr>
          <td><button type="button" class="linkish" data-player="${esc(row.name)}" data-captain="1">${esc(row.name)}</button></td>
          <td class="num">${row.count}</td>
          <td class="num">${fmtPts(row.avg)}</td>
          <td class="num">${fmtPts(row.median)}</td>
          <td class="num">${fmtPts(row.best)}</td>
          <td class="num">${fmtPct(row.avgOpt)}</td>
        </tr>`).join('')
    : '<tr><td colspan="6">No MVP or captain column in this filter.</td></tr>';
  const playerRows = shown.map((player) => `
    <tr>
      <td><button type="button" class="linkish" data-player="${esc(player.name)}">${esc(player.name)}</button></td>
      <td class="num">${player.count}</td>
      <td><div class="${barClass}"><span style="width:${Math.max(2, Math.round(player.exposure * 100))}%"></span></div><div class="fine">${fmtPct(player.exposure)}</div></td>
      <td class="num">${fmtPts(player.avg)}</td>
      <td class="num">${player.mvp ? fmtPts(player.mvpAvg) : '—'}</td>
      <td class="num">${player.mvp || '—'}</td>
    </tr>`).join('');
  const more = players.length > 12
    ? `<button type="button" class="btn" data-action="toggle-players" style="margin-top:12px">${showAllPlayers ? 'Show top 12' : `Show all ${players.length}`}</button>`
    : '';
  const chartHeight = Math.max(240, captains.length * 28);
  return `
    <section class="card">
      <h2>${esc(appName)} captains</h2>
      <p class="subhead">Average lineup score with this player as MVP or captain. Click a name to filter.</p>
      ${captains.length ? `<div class="chart-box" style="height:${chartHeight}px"><canvas id="chart-mvp-${esc(key)}" role="img" aria-label="${esc(appName)} captain averages"></canvas></div>` : ''}
      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>Captain</th><th class="num">Lineups</th><th class="num">Avg</th><th class="num">Median</th><th class="num">Best</th><th class="num">% opt</th></tr></thead>
          <tbody>${captainRows}</tbody>
        </table>
      </div>
      <h2 style="margin-top:22px">Exposure vs points</h2>
      <p class="subhead">Share of lineups that include the player, against the average score of those lineups. Points are lineup totals.</p>
      <div class="chart-box tall"><canvas id="chart-exp-${esc(key)}" role="img" aria-label="${esc(appName)} exposure versus points"></canvas></div>
      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>Player</th><th class="num">Lineups</th><th>Exposure</th><th class="num">Avg pts</th><th class="num">MVP avg</th><th class="num">As MVP</th></tr></thead>
          <tbody>${playerRows}</tbody>
        </table>
      </div>
      ${more}
    </section>`;
}

function renderExplorer(rows) {
  const sorted = [...rows].sort((a, b) => compareRows(a, b, explorer.sort, explorer.dir));
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  if (explorer.page > pages) explorer.page = pages;
  const start = (explorer.page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);
  const body = slice.length
    ? slice.map((row) => `
        <tr>
          <td>${esc(row.date)}</td>
          <td><span class="pill ${appKey(row.app)}">${esc(row.app)}</span></td>
          <td>${esc(row.slate)}<div class="fine">${esc(row.sport)} · ${esc(row.site)} · ${esc(row.format)}</div></td>
          <td>${esc(row.contestType)}<div class="fine">${esc(row.contestName)}</div></td>
          <td class="num">${fmtMoney(row.fee)}</td>
          <td>${row.captain ? esc(row.captain) : '—'}</td>
          <td>${esc(row.slots.filter((slot) => !slot.captain).map((slot) => slot.name).join(', ') || '—')}</td>
          <td class="num">${fmtSalary(row.salary)}</td>
          <td class="num">${fmtPts(row.points)}</td>
          <td class="num">${fmtPct(row.optRatio)}</td>
          <td class="num">${fmtFinish(row)}</td>
          <td class="num">${fmtMoney(row.winnings)}</td>
        </tr>`).join('')
    : '<tr><td colspan="12">No lineups match this filter.</td></tr>';
  const from = sorted.length ? start + 1 : 0;
  const to = start + slice.length;
  if (!sorted.length) {
    return `
      <div class="stack">
        ${errorBanner()}
        <header>
          <p class="eyebrow">Explorer</p>
          <p class="page-title" data-explorer-count="0">0 lineups</p>
        </header>
        ${emptyFilter()}
      </div>`;
  }
  return `
    <div class="stack">
      ${errorBanner()}
      <header>
        <p class="eyebrow">Explorer</p>
        <p class="page-title" data-explorer-count="${sorted.length}">${sorted.length} lineup${sorted.length === 1 ? '' : 's'}</p>
        <p class="fine">Every lineup in the current filter. Blank finish and winnings mean the contest is not settled.</p>
      </header>
      <section class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                ${th('Date', 'date')}
                ${th('App', 'app')}
                ${th('Slate', 'slate')}
                ${th('Contest', 'contestType')}
                ${th('Fee', 'fee', 'num')}
                ${th('Captain', 'captain')}
                <th>Lineup</th>
                ${th('Salary', 'salary', 'num')}
                ${th('Pts', 'points', 'num')}
                ${th('% opt', 'optRatio', 'num')}
                ${th('Finish', 'finish', 'num')}
                ${th('Won', 'winnings', 'num')}
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div class="pager">
          <button type="button" data-page-n="${explorer.page - 1}" ${explorer.page <= 1 ? 'disabled' : ''}>Prev</button>
          <span class="fine">${from}–${to} of ${sorted.length}</span>
          <button type="button" data-page-n="${explorer.page + 1}" ${explorer.page >= pages ? 'disabled' : ''}>Next</button>
        </div>
      </section>
    </div>`;
}

function th(label, key, extra = '') {
  const active = explorer.sort === key;
  const aria = active ? (explorer.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const mark = active ? (explorer.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th class="${extra}" aria-sort="${aria}"><button type="button" data-sort="${key}">${label}${mark}</button></th>`;
}

function fmtFinish(row) {
  if (row.finish == null) return '—';
  if (row.fieldSize == null) return fmtInt(row.finish);
  return `${fmtInt(row.finish)} / ${fmtInt(row.fieldSize)}`;
}

function compareRows(a, b, key, dir) {
  const left = a[key];
  const right = b[key];
  const leftNil = left == null || left === '';
  const rightNil = right == null || right === '';
  if (leftNil && rightNil) return (b.points ?? -1) - (a.points ?? -1);
  if (leftNil) return 1;
  if (rightNil) return -1;
  let delta = 0;
  if (typeof left === 'number' && typeof right === 'number') delta = left - right;
  else delta = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
  if (delta === 0) return (b.points ?? -1) - (a.points ?? -1);
  return dir === 'asc' ? delta : -delta;
}

function onMainClick(event) {
  const action = event.target.closest('[data-action]');
  if (action?.dataset.action === 'reset') {
    resetFilters();
    return;
  }
  if (action?.dataset.action === 'toggle-players') {
    showAllPlayers = !showAllPlayers;
    safeRender();
    return;
  }
  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) {
    const key = sortButton.dataset.sort;
    if (explorer.sort === key) explorer.dir = explorer.dir === 'asc' ? 'desc' : 'asc';
    else {
      explorer.sort = key;
      explorer.dir = NUMERIC_SORTS.has(key) ? 'desc' : 'asc';
    }
    safeRender();
    return;
  }
  const pageButton = event.target.closest('[data-page-n]');
  if (pageButton && !pageButton.disabled) {
    explorer.page = Number(pageButton.dataset.pageN);
    safeRender();
    return;
  }
  const contest = event.target.closest('[data-set-contest]');
  if (contest) {
    const name = contest.dataset.setContest;
    filters.contestTypes = filters.contestTypes.length === 1 && filters.contestTypes[0] === name ? [] : [name];
    safeRender({ filtersChanged: true });
    return;
  }
  const fee = event.target.closest('[data-set-fee-bucket]');
  if (fee) {
    const name = fee.dataset.setFeeBucket;
    filters.feeBuckets = filters.feeBuckets.length === 1 && filters.feeBuckets[0] === name ? [] : [name];
    safeRender({ filtersChanged: true });
    return;
  }
  const player = event.target.closest('[data-player]');
  if (player) {
    filters.player = player.dataset.player;
    filters.mvpOnly = player.dataset.captain === '1';
    safeRender({ filtersChanged: true });
    document.getElementById('filter-summary')?.scrollIntoView({ block: 'nearest' });
  }
}

function buildCharts(viewName, sel) {
  ensureChartDefaults();
  if (viewName === 'lineups' || typeof Chart === 'undefined') return;
  const rows = sel.view;
  if (!rows.length) return;
  buildTrend(rows);
  buildHist(rows);
  buildContestChart(rows);
  buildFeeChart(rows);
  const groups = viewName === 'overview'
    ? orderedApps(rows).map((app) => ({ app, rows: rows.filter((row) => row.app === app) }))
    : [{ app: rows[0].app, rows }];
  for (const group of groups) {
    buildMvpChart(group.app, group.rows);
    buildExposureChart(group.app, group.rows);
  }
}

function buildTrend(rows) {
  const { dates, series } = trend(rows);
  if (!dates.length) return;
  mountChart('chart-trend', {
    type: 'line',
    data: {
      labels: dates.map(fmtDateShort),
      datasets: series.map((seriesItem) => {
        const style = styleFor(seriesItem.app);
        return {
          label: seriesItem.app,
          data: seriesItem.points.map((point) => point.avg),
          borderColor: style.solid,
          backgroundColor: style.soft,
          pointBackgroundColor: style.b,
          pointRadius: 4,
          borderWidth: 2,
          tension: 0.25,
          spanGaps: true,
        };
      }),
    },
    options: {
      ...chartBase(),
      plugins: {
        legend: { display: series.length > 1, labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label(context) {
              const point = series[context.datasetIndex].points[context.dataIndex];
              if (!point || point.avg == null) return `${context.dataset.label}: no scores`;
              return `${context.dataset.label}: avg ${fmtPts(point.avg)} · best ${fmtPts(point.best)} · ${point.count} scored`;
            },
          },
        },
      },
      scales: {
        x: axisStyle(),
        y: { ...axisStyle(), beginAtZero: false },
      },
    },
  });
}

function buildHist(rows) {
  const { bins } = histogram(rows);
  if (!bins.length) return;
  const apps = orderedApps(rows);
  mountChart('chart-hist', {
    type: 'bar',
    data: {
      labels: bins.map((bin) => `${trimNum(bin.from)}–${trimNum(bin.to)}`),
      datasets: apps.map((app) => ({
        label: app,
        data: bins.map((bin) => bin.byApp[app] || 0),
        backgroundColor: gradientFor(app, false),
        borderWidth: 0,
        borderRadius: 5,
        maxBarThickness: 28,
      })),
    },
    options: {
      ...chartBase(),
      plugins: {
        legend: { display: apps.length > 1, labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: tooltipStyle(),
      },
      scales: {
        x: { ...axisStyle(), stacked: true },
        y: { ...axisStyle(), stacked: true, beginAtZero: true, ticks: { ...axisStyle().ticks, precision: 0 } },
      },
    },
  });
}

function trimNum(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildContestChart(rows) {
  const apps = orderedApps(rows);
  const types = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.contestType)) continue;
    seen.add(row.contestType);
    types.push(row.contestType);
  }
  types.sort((a, b) => contestRank(a) - contestRank(b) || a.localeCompare(b));
  mountChart('chart-contest', {
    type: 'bar',
    data: {
      labels: types,
      datasets: apps.map((app) => ({
        label: app,
        data: types.map((type) => scoreStats(rows.filter((row) => row.app === app && row.contestType === type)).avg),
        backgroundColor: gradientFor(app, false),
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 42,
      })),
    },
    options: {
      ...chartBase(),
      plugins: {
        legend: { display: apps.length > 1, labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label(context) {
              const value = context.parsed.y;
              return value == null ? `${context.dataset.label}: —` : `${context.dataset.label}: ${fmtPts(value)} avg`;
            },
          },
        },
      },
      scales: {
        x: axisStyle(),
        y: { ...axisStyle(), beginAtZero: true },
      },
    },
  });
}

function buildFeeChart(rows) {
  const present = FEE_BUCKETS.filter((bucket) => rows.some((row) => row.feeBucket === bucket));
  const apps = orderedApps(rows);
  mountChart('chart-fee', {
    type: 'bar',
    data: {
      labels: present,
      datasets: apps.map((app) => ({
        label: app,
        data: present.map((bucket) => rows.filter((row) => row.app === app && row.feeBucket === bucket).length),
        backgroundColor: gradientFor(app, true),
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 22,
      })),
    },
    options: {
      ...chartBase(),
      indexAxis: 'y',
      plugins: {
        legend: { display: apps.length > 1, labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: tooltipStyle(),
      },
      scales: {
        x: { ...axisStyle(), beginAtZero: true, ticks: { ...axisStyle().ticks, precision: 0 } },
        y: axisStyle(),
      },
    },
  });
}

function buildMvpChart(appName, rows) {
  const captains = mvpTable(rows);
  if (!captains.length) return;
  mountChart(`chart-mvp-${appKey(appName)}`, {
    type: 'bar',
    data: {
      labels: captains.map((row) => row.name),
      datasets: [{
        label: 'Avg lineup pts',
        data: captains.map((row) => row.avg),
        backgroundColor: gradientFor(appName, true),
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 16,
      }],
    },
    options: {
      ...chartBase(),
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label(context) {
              const row = captains[context.dataIndex];
              return `${fmtPts(row.avg)} avg · ${row.count} lineups · best ${fmtPts(row.best)}`;
            },
          },
        },
      },
      scales: {
        x: { ...axisStyle(), beginAtZero: true },
        y: axisStyle(),
      },
    },
  });
}

function buildExposureChart(appName, rows) {
  const players = exposure(rows).filter((player) => player.avg != null);
  if (!players.length) return;
  const style = styleFor(appName);
  mountChart(`chart-exp-${appKey(appName)}`, {
    type: 'scatter',
    data: {
      datasets: [{
        label: appName,
        data: players.map((player) => ({
          x: player.exposure * 100,
          y: player.avg,
          name: player.name,
          count: player.count,
        })),
        backgroundColor: style.soft,
        borderColor: style.solid,
        pointRadius: (context) => {
          const count = context.raw?.count || 1;
          return Math.max(5, Math.min(16, Math.sqrt(count) * 1.6));
        },
      }],
    },
    options: {
      ...chartBase(),
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label(context) {
              const point = context.raw;
              return `${point.name}: ${point.x.toFixed(1)}% exp · ${fmtPts(point.y)} pts · ${point.count} lineups`;
            },
          },
        },
      },
      scales: {
        x: {
          ...axisStyle(),
          title: { display: true, text: 'Exposure %', color: themeColor('--chart-text', '#b7c6dc') },
          beginAtZero: true,
        },
        y: {
          ...axisStyle(),
          title: { display: true, text: 'Avg lineup pts', color: themeColor('--chart-text', '#b7c6dc') },
        },
      },
    },
  });
}

function chartBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: reduceMotion ? 0 : 450 },
  };
}

boot();
