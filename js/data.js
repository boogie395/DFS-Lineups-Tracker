import { feeBucket, fieldBucket, maxEntryBucket, poolBucket } from './metrics.js';

const META = new Set([
  'date',
  'sport',
  'site',
  'format',
  'slate',
  'app',
  'contest_name',
  'contest_type',
  'max_entries',
  'prize_pool',
  'entry_fee',
  'used',
  'salary',
  'points',
  'optimal_points',
  'finish',
  'field_size',
  'winnings',
]);

/** Never render these. They are not lineup slots, and some are personal. */
const IGNORE = new Set([
  'entry_id',
  'entryid',
  'username',
  'user',
  'user_id',
  'userid',
  'email',
  'owner',
  'notes',
  'note',
  'comment',
  'comments',
]);

function num(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUsed(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ['y', 'yes', 'true', '1', 'entered', 'used'].includes(text);
}

function isCaptainHeader(header) {
  return /^(mvp|cpt|captain|capt)$/i.test(header.trim());
}

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const table = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      table.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    table.push(row);
  }
  const headers = (table.shift() || []).map((header) => header.trim());
  return { headers, rows: table };
}

export function normalize(headers, values) {
  const meta = {};
  const slots = [];
  headers.forEach((header, index) => {
    const key = header.trim();
    if (!key) return;
    const raw = String(values[index] ?? '').trim();
    const lower = key.toLowerCase();
    if (META.has(lower)) {
      meta[lower] = raw;
      return;
    }
    if (IGNORE.has(lower)) return;
    if (raw) slots.push({ label: key, name: raw, captain: isCaptainHeader(key) });
  });

  const points = num(meta.points);
  const optimal = num(meta.optimal_points);
  const captainSlot = slots.find((slot) => slot.captain);
  const players = [];
  const seen = new Set();
  for (const slot of slots) {
    if (seen.has(slot.name)) continue;
    seen.add(slot.name);
    players.push(slot.name);
  }

  const fee = num(meta.entry_fee);
  const maxEntries = num(meta.max_entries);
  const prizePool = num(meta.prize_pool);
  const fieldSize = num(meta.field_size);

  return {
    date: meta.date || '',
    sport: meta.sport || '',
    site: meta.site || '',
    format: meta.format || '',
    slate: meta.slate || '',
    app: meta.app || 'Unknown',
    contestName: meta.contest_name || '',
    contestType: meta.contest_type || 'Unknown',
    maxEntries,
    prizePool,
    fee,
    salary: num(meta.salary),
    points,
    optimal,
    optRatio: points != null && optimal != null && optimal > 0 ? points / optimal : null,
    finish: num(meta.finish),
    fieldSize,
    winnings: num(meta.winnings),
    used: parseUsed(meta.used),
    slots,
    players,
    captain: captainSlot ? captainSlot.name : '',
    captainLabel: captainSlot ? captainSlot.label : '',
    feeBucket: feeBucket(fee),
    maxEntryBucket: maxEntryBucket(maxEntries),
    fieldBucket: fieldBucket(fieldSize),
    poolBucket: poolBucket(prizePool),
  };
}

export function rowsFromCSV(text) {
  const { headers, rows } = parseCSV(text);
  return rows
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row) => normalize(headers, row));
}

export async function loadLineups() {
  const manifestUrl = new URL('../data/manifest.json', import.meta.url);
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Could not load data/manifest.json (${response.status}). Start a static server from the repo root.`);
  }
  const manifest = await response.json();
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const lineups = [];
  const errors = [];
  for (const path of files) {
    const encoded = String(path).split('/').map((part) => encodeURIComponent(part)).join('/');
    const url = new URL(`../${encoded}`, import.meta.url);
    try {
      const fileResponse = await fetch(url);
      if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
      const text = await fileResponse.text();
      for (const row of rowsFromCSV(text)) lineups.push(row);
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
    }
  }
  return { lineups, errors, files };
}
