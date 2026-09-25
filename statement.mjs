// Bank PDFs vary widely. Only a single, explicitly signed amount on a dated
// line is interpreted; every other line remains visible for manual review.
const DATE = /^(\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})\b\s*/;
const MONEY = /(?<![\d.,])([+-]?\s*€?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})(?![\d.,])/g;

function isoDate(value, year) {
  let y, m, d;
  if (value.includes('-')) [y, m, d] = value.split('-').map(Number);
  else {
    const parts = value.split('/').map(Number);
    [d, m] = parts;
    y = parts.length === 3 ? parts[2] : Number(year);
  }
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseStatement(text, {year} = {}) {
  const rows = [], unparsed = [];
  for (const [index, source] of String(text).split(/\r?\n/).entries()) {
    const raw = source.trim();
    if (!raw) continue;
    const dated = raw.match(DATE);
    if (!dated) {
      unparsed.push({lineNumber: index + 1, raw});
      continue;
    }
    const dateText = dated[1], body = raw.slice(dated[0].length).trim();
    const date = isoDate(dateText, year);
    const matches = [...body.matchAll(MONEY)];
    let description = body, amount = null, type = null;
    const issues = [];
    if (!date) issues.push(dateText.split('/').length === 2 && !year ? 'Enter the statement year.' : 'Check the date.');
    if (matches.length === 1 && matches[0].index + matches[0][0].length === body.length) {
      const token = matches[0][1].replace(/\s/g, '');
      description = body.slice(0, matches[0].index).trim();
      amount = Math.round(Number(token.replace(/^[+-]?€?/, '').replace(/\./g, '').replace(',', '.')) * 100);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        amount = null; issues.push('Check the amount.');
      } else if (/^[+-]/.test(token)) type = token[0] === '-' ? 'expense' : 'income';
      else issues.push('Choose income or expense; the amount has no sign.');
    } else issues.push(matches.length > 1 ? 'Several amounts on this line; choose the transaction amount.' : 'Enter the amount and choose income or expense.');
    if (!description) issues.push('Enter a description.');
    rows.push({lineNumber: index + 1, raw, dateText, date, description, type, amount, issues});
  }
  return {rows, unparsed};
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function identifyImportRows(text, rows, existing, accountId) {
  const importSource = `pdf:${await sha256(String(text).replace(/\r\n/g, '\n'))}`;
  const occurrences = new Map();
  const hashes = new Map();
  return Promise.all(rows.map(async row => {
    const raw = row.raw.trim().replace(/\s+/g, ' ');
    const occurrence = (occurrences.get(raw) || 0) + 1;
    occurrences.set(raw, occurrence);
    if (!hashes.has(raw)) hashes.set(raw, sha256(raw));
    const importKey = `${await hashes.get(raw)}:${occurrence}`;
    const exactDuplicate = existing.some(item => item.accountId === accountId && item.importSource === importSource && item.importKey === importKey);
    const possibleDuplicates = row.date && row.type && row.amount ? existing.filter(item => item.accountId === accountId && item.date === row.date && item.type === row.type && item.amount === row.amount && !(item.importSource === importSource && item.importKey === importKey)) : [];
    return {...row, occurrence, importSource, importKey, exactDuplicate, possibleDuplicates};
  }));
}

export function normalizeMerchant(description) {
  return String(description).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-PT');
}

export function suggestCategory(description, rules = []) {
  return rules.find(rule => rule.merchant === normalizeMerchant(description))?.category || null;
}

export function rememberMerchant(rules, description, category) {
  const merchant = normalizeMerchant(description);
  if (!merchant || merchant.length > 120) return rules;
  return [...rules.filter(rule => rule.merchant !== merchant), {merchant, category}];
}
