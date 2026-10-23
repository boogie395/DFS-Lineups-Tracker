/** Pure lineup math. Blank result fields stay null so ROI and cash rate can hide. */

export const FEE_BUCKETS = ['Under $1', '$1-$5', '$5-$20', '$20-$100', '$100+', 'Unknown'];
export const MAX_ENTRY_BUCKETS = ['Single entry', '3-max', '5-max', '20-max', '150-max', '150+ max', 'Unknown'];
export const FIELD_BUCKETS = ['< 100', '100-999', '1k-9.9k', '10k-49k', '50k+', 'Unknown'];
export const POOL_BUCKETS = ['Under $1k', '$1k-$5k', '$5k-$20k', '$20k-$100k', '$100k+', 'Unknown'];

export function appKey(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('grok')) return 'grok';
  if (n.includes('chatgpt') || n.includes('gpt')) return 'chatgpt';
  return n.replace(/[^a-z0-9]+/g, '') || 'other';
}

export function feeBucket(n) {
  if (n == null) return 'Unknown';
  if (n < 1) return 'Under $1';
  if (n < 5) return '$1-$5';
  if (n < 20) return '$5-$20';
  if (n < 100) return '$20-$100';
  return '$100+';
}

export function maxEntryBucket(n) {
  if (n == null) return 'Unknown';
  if (n <= 1) return 'Single entry';
  if (n <= 3) return '3-max';
  if (n <= 5) return '5-max';
  if (n <= 20) return '20-max';
  if (n <= 150) return '150-max';
  return '150+ max';
}

export function fieldBucket(n) {
  if (n == null) return 'Unknown';
  if (n < 100) return '< 100';
  if (n < 1000) return '100-999';
  if (n < 10000) return '1k-9.9k';
  if (n < 50000) return '10k-49k';
  return '50k+';
}

export function poolBucket(n) {
  if (n == null) return 'Unknown';
  if (n < 1000) return 'Under $1k';
  if (n < 5000) return '$1k-$5k';
  if (n < 20000) return '$5k-$20k';
  if (n < 100000) return '$20k-$100k';
  return '$100k+';
}

export function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function sumMoney(rows, key) {
  let cents = 0;
  for (const row of rows) cents += Math.round(row[key] * 100);
  return cents / 100;
}

export function scoreStats(rows) {
  const points = [];
  const optRatios = [];
  let bestRow = null;
  for (const row of rows) {
    if (row.points != null) {
      points.push(row.points);
      if (!bestRow || row.points > bestRow.points) bestRow = row;
    }
    if (row.optRatio != null) optRatios.push(row.optRatio);
  }
  return {
    count: rows.length,
    scored: points.length,
    avg: average(points),
    median: median(points),
    best: bestRow ? bestRow.points : null,
    bestRow,
    avgOpt: average(optRatios),
  };
}

export function moneyStats(rows) {
  const withFee = rows.filter((row) => row.fee != null);
  const settled = rows.filter((row) => row.winnings != null);
  const roiRows = rows.filter((row) => row.winnings != null && row.fee != null);
  const placed = rows.filter((row) => row.finish != null && row.fieldSize != null && row.fieldSize > 0);
  const top1 = placed.filter((row) => row.finish / row.fieldSize <= 0.01).length;
  const top10 = placed.filter((row) => row.finish / row.fieldSize <= 0.1).length;
  const cashed = settled.filter((row) => row.winnings > 0).length;
  const roiFees = roiRows.length ? sumMoney(roiRows, 'fee') : 0;
  const roiWins = roiRows.length ? sumMoney(roiRows, 'winnings') : 0;
  return {
    rows: rows.length,
    feeCount: withFee.length,
    fees: withFee.length ? sumMoney(withFee, 'fee') : null,
    settled: settled.length,
    winnings: settled.length ? sumMoney(settled, 'winnings') : null,
    roiRows: roiRows.length,
    roi: roiRows.length && roiFees > 0 ? (roiWins - roiFees) / roiFees : null,
    cashRate: settled.length ? cashed / settled.length : null,
    cashed,
    placed: placed.length,
    top1,
    top10,
    top1Rate: placed.length ? top1 / placed.length : null,
    top10Rate: placed.length ? top10 / placed.length : null,
  };
}

export function applyFilters(rows, filters, opts = {}) {
  const player = String(filters.player || '').trim().toLowerCase();
  const feeMin = filters.feeMin === '' || filters.feeMin == null ? null : Number(filters.feeMin);
  const feeMax = filters.feeMax === '' || filters.feeMax == null ? null : Number(filters.feeMax);
  return rows.filter((row) => {
    if (opts.appLock) {
      if (appKey(row.app) !== opts.appLock) return false;
    } else if (filters.apps.length && !filters.apps.includes(row.app)) {
      return false;
    }
    if (!opts.skipUsage) {
      if (filters.usage === 'entered' && !row.used) return false;
      if (filters.usage === 'bench' && row.used) return false;
    }
    if (filters.dateFrom && row.date < filters.dateFrom) return false;
    if (filters.dateTo && row.date > filters.dateTo) return false;
    if (filters.sports.length && !filters.sports.includes(row.sport)) return false;
    if (filters.sites.length && !filters.sites.includes(row.site)) return false;
    if (filters.formats.length && !filters.formats.includes(row.format)) return false;
    if (filters.slates.length && !filters.slates.includes(row.slate)) return false;
    if (filters.contestTypes.length && !filters.contestTypes.includes(row.contestType)) return false;
    if (filters.contestNames?.length && !filters.contestNames.includes(row.contestName)) return false;
    if (Number.isFinite(feeMin) && (row.fee == null || row.fee < feeMin)) return false;
    if (Number.isFinite(feeMax) && (row.fee == null || row.fee > feeMax)) return false;
    if (filters.feeBuckets.length && !filters.feeBuckets.includes(row.feeBucket)) return false;
    if (filters.maxEntryBuckets.length && !filters.maxEntryBuckets.includes(row.maxEntryBucket)) return false;
    if (filters.fieldBuckets.length && !filters.fieldBuckets.includes(row.fieldBucket)) return false;
    if (filters.poolBuckets.length && !filters.poolBuckets.includes(row.poolBucket)) return false;
    if (player) {
      if (filters.mvpOnly) {
        if (!row.captain || !row.captain.toLowerCase().includes(player)) return false;
      } else if (!row.players.some((name) => name.toLowerCase().includes(player))) {
        return false;
      }
    }
    return true;
  });
}

export function histogram(rows) {
  const scored = rows.filter((row) => row.points != null);
  if (!scored.length) return { bins: [] };
  const values = scored.map((row) => row.points);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const start = Math.floor(minValue / 5) * 5;
  const end = Math.max(start + 5, Math.ceil(maxValue / 5) * 5);
  let width = 5;
  if (Math.ceil((end - start) / width) > 24) width = 10;
  const count = Math.max(1, Math.ceil((end - start) / width));
  const bins = Array.from({ length: count }, (_, index) => ({
    from: start + index * width,
    to: start + (index + 1) * width,
    byApp: {},
    total: 0,
  }));
  for (const row of scored) {
    let index = Math.floor((row.points - start) / width);
    if (index < 0) index = 0;
    if (index >= bins.length) index = bins.length - 1;
    const bin = bins[index];
    bin.total += 1;
    bin.byApp[row.app] = (bin.byApp[row.app] || 0) + 1;
  }
  return { bins, width };
}

export function trend(rows) {
  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].sort();
  const apps = [];
  const seen = new Set();
  for (const row of rows) {
    if (!seen.has(row.app)) {
      seen.add(row.app);
      apps.push(row.app);
    }
  }
  const series = apps.map((app) => ({
    app,
    points: dates.map((date) => {
      const subset = rows.filter((row) => row.app === app && row.date === date && row.points != null);
      return {
        date,
        avg: average(subset.map((row) => row.points)),
        best: subset.length ? Math.max(...subset.map((row) => row.points)) : null,
        count: subset.length,
      };
    }),
  }));
  return { dates, series };
}

export function bestBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    if (row.points == null) continue;
    const key = keyFn(row);
    const prev = map.get(key);
    if (!prev || row.points > prev.points) map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.points - a.points || String(a.date).localeCompare(String(b.date)));
}

export function groupStats(rows, moneyRows, keyFn) {
  const moneySet = new Set(moneyRows);
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  const out = [];
  for (const [key, list] of map) {
    out.push({
      key,
      ...scoreStats(list),
      money: moneyStats(list.filter((row) => moneySet.has(row))),
    });
  }
  out.sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  return out;
}

export function exposure(rows) {
  if (!rows.length) return [];
  const map = new Map();
  for (const row of rows) {
    for (const name of row.players) {
      if (!map.has(name)) {
        map.set(name, { name, count: 0, points: [], mvp: 0, mvpPoints: [] });
      }
      const rec = map.get(name);
      rec.count += 1;
      if (row.points != null) rec.points.push(row.points);
    }
    if (row.captain && map.has(row.captain)) {
      const rec = map.get(row.captain);
      rec.mvp += 1;
      if (row.points != null) rec.mvpPoints.push(row.points);
    }
  }
  return [...map.values()]
    .map((rec) => ({
      name: rec.name,
      count: rec.count,
      exposure: rec.count / rows.length,
      avg: average(rec.points),
      best: rec.points.length ? Math.max(...rec.points) : null,
      mvp: rec.mvp,
      mvpAvg: average(rec.mvpPoints),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function mvpTable(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.captain) continue;
    if (!map.has(row.captain)) map.set(row.captain, []);
    map.get(row.captain).push(row);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, ...scoreStats(list) }))
    .sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity) || b.count - a.count || a.name.localeCompare(b.name));
}
