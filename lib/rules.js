// Loads the rules table (data/*.csv). The CSV is the source of truth:
// edit it in Excel, export as CSV, and the app picks it up.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

let cache;
export function loadRules({ region = 'US', category = 'supplement' } = {}) {
  if (!cache) {
    cache = readdirSync(DATA_DIR)
      .filter((f) => f.startsWith('rules_') && f.endsWith('.csv'))
      .flatMap((f) => parseCsv(readFileSync(path.join(DATA_DIR, f), 'utf8')));
  }
  return cache.filter((r) => r.region === region && r.category === category);
}
