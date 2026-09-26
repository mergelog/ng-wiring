import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './fixtures/harness.mjs';

const tasksFile = path.join(repoRoot, 'x-local/_old/x-tasks.md');
const localTasks = { skip: !existsSync(tasksFile) };

/** §10 P16-15: the A01–A24 table is the place the acceptance conditions are managed, so it is checked. */
async function acceptanceTable() {
  const text = await readFile(tasksFile, 'utf8');
  const section = text.slice(text.indexOf('## 受け入れ条件 A01〜A24'));
  const rows = section.split('\n').filter(line => /^\| A\d\d \|/.test(line));
  return rows.map(row => {
    const cells = row.split('|').map(cell => cell.trim());
    return { id: cells[1], condition: cells[2], implementation: cells[3], fixture: cells[4], ci: cells[5] };
  });
}

const states = ['[ ]', '[~]', '[x]'];

test('the acceptance table carries A01 to A24 with three separate states each', localTasks, async () => {
  const rows = await acceptanceTable();
  assert.equal(rows.length, 24, 'the table does not hold one row per acceptance condition');
  rows.forEach((row, index) => {
    const expected = `A${String(index + 1).padStart(2, '0')}`;
    assert.equal(row.id, expected, `row ${index + 1} is ${row.id}`);
    assert(row.condition.length > 0, `${row.id} states no condition`);
    for (const [name, value] of [['実装', row.implementation], ['fixture', row.fixture], ['CI', row.ci]]) {
      assert(states.includes(value), `${row.id} ${name} is ${value}, which is not one of ${states.join(' ')}`);
    }
  });
});

// §10 the three columns are separate states, and they only move in one order: a green fixture or a CI
// check for something that is not implemented would be reporting a pass for work that does not exist.
test('no acceptance condition claims a fixture or a CI check ahead of its implementation', localTasks, async () => {
  for (const row of await acceptanceTable()) {
    if (row.implementation === '[ ]') {
      assert.equal(row.fixture, '[ ]', `${row.id} claims a fixture without an implementation`);
      assert.equal(row.ci, '[ ]', `${row.id} claims a CI check without an implementation`);
    }
    if (row.fixture === '[ ]') {
      assert.equal(row.ci, '[ ]', `${row.id} claims a CI check without a fixture`);
    }
  }
});

// P16-15: what P16 finished is recorded in the table rather than only in a commit message.
test('the conditions P16 completed are marked in the table', localTasks, async () => {
  const rows = new Map((await acceptanceTable()).map(row => [row.id, row]));
  for (const id of ['A23', 'A24']) {
    const row = rows.get(id);
    assert.deepEqual([row.implementation, row.fixture, row.ci], ['[x]', '[x]', '[x]'],
      `${id} is not marked complete although P16 covers it`);
  }
  // The rows P16 only partly covered say so instead of claiming either extreme.
  for (const id of ['A14', 'A19', 'A20', 'A22']) {
    assert.equal(rows.get(id).fixture, '[~]', `${id} does not record its partial fixture coverage`);
  }
});
