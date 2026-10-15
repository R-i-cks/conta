import assert from 'node:assert/strict';
import {parseStatement, identifyImportRows, normalizeMerchant, suggestCategory, rememberMerchant} from './statement.mjs';

const text = 'Statement\n24/09/2026 MARKET -12,34\n24/09/2026 MARKET -12,34\n25/09/2026 SALARY +1.234,56\n26/09 MARKET 9,99\n27/09/2026 CARD 12,34 345,67\n';
const {rows, unparsed} = parseStatement(text, {year: 2026});
assert.equal(unparsed[0].raw, 'Statement');
assert.deepEqual(rows.slice(0, 3).map(({date, type, amount}) => [date, type, amount]), [
  ['2026-09-24', 'expense', 1234], ['2026-09-24', 'expense', 1234], ['2026-09-25', 'income', 123456]
]);
assert.equal(rows[3].date, '2026-09-26');
assert.equal(rows[3].amount, 999);
assert.equal(rows[3].type, null);
assert.equal(rows[4].amount, null);
assert.equal(parseStatement('29/02/2025 TEST -1,00').rows[0].date, null);
assert.equal(parseStatement('26/09 TEST -1,00').rows[0].date, null);

const marked = await identifyImportRows(text, rows, [], 'bank');
assert.notEqual(marked[0].importKey, marked[1].importKey);
assert.equal(marked[0].occurrence, 1);
assert.equal(marked[1].occurrence, 2);
const again = await identifyImportRows(text, rows, [
  {...rows[0], accountId: 'bank', importSource: marked[0].importSource, importKey: marked[0].importKey},
  {accountId: 'bank', date: '2026-09-25', type: 'income', amount: 123456, description: 'Pay'}
], 'bank');
assert.equal(again[0].exactDuplicate, true);
assert.equal(again[1].exactDuplicate, false);
assert.equal(again[1].possibleDuplicates.length, 1);
assert.equal(again[2].possibleDuplicates.length, 1);
assert.equal(normalizeMerchant('  Café   DO   Bairro  '), 'café do bairro');
const rules = rememberMerchant([], ' Café   DO Bairro ', 'Dining');
assert.equal(suggestCategory('café do bairro', rules), 'Dining');
assert.equal(rememberMerchant(rules, 'CAFÉ DO BAIRRO', 'Groceries').length, 1);
// A blank debit column rendered as ' - ' is not a minus sign; the row must ask for a direction.
const gap = parseStatement('24/09/2026 SALARIO - 1.234,56').rows[0];
assert.equal(gap.type, null);
assert.equal(gap.amount, 123456);
assert.equal(parseStatement('24/09/2026 SALARIO -€ 1.234,56').rows[0].type, 'expense');
