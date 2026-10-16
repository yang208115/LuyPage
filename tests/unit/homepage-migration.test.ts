import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { DEFAULT_HOMEPAGE_PREFERENCES } from '../../packages/contracts/src/types';

it('upgrades an existing database without changing its bookmarks, groups or layout', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync('packages/persistence/migrations/0001_core.sql', 'utf8'));
    db.exec(readFileSync('packages/persistence/migrations/0002_jobs.sql', 'utf8'));
    db.exec(`INSERT INTO users VALUES ('owner', '2026-10-01');
      INSERT INTO workspace_state(owner_id, data_revision) VALUES ('owner', 12);
      INSERT INTO groups VALUES ('owner', 'group', '书房', '书房', 1024, '2026-10-01', 3);
      INSERT INTO bookmarks VALUES ('owner', 'bookmark', 'https://example.com', 'https://example.com', '网站', '网站', 'note', '网站', 'group', 1, 1024, 1024, 'builtin', 'book', '2026-10-01', '2026-10-01', NULL, 2);`);
    const layout = db.prepare('SELECT owner_id, data_revision, preferences FROM workspace_state').all();
    const groups = db.prepare('SELECT * FROM groups').all();
    const bookmarks = db.prepare('SELECT * FROM bookmarks').all();
    db.exec(readFileSync('packages/persistence/migrations/0003_homepage.sql', 'utf8'));
    db.exec(readFileSync('packages/persistence/migrations/0004_homepage_layout.sql', 'utf8'));
    expect(JSON.parse(db.prepare('SELECT homepage_layout FROM workspace_state').get()!.homepage_layout as string)).toEqual({ version: 1, desktop: null, mobile: null });
    expect(db.prepare('SELECT owner_id, data_revision, preferences FROM workspace_state').all()).toEqual(layout);
    expect(db.prepare('SELECT * FROM groups').all()).toEqual(groups);
    expect(db.prepare('SELECT * FROM bookmarks').all()).toEqual(bookmarks);
    const row = db.prepare('SELECT homepage_preferences FROM workspace_state').get()!;
    expect(JSON.parse(row.homepage_preferences as string)).toEqual(DEFAULT_HOMEPAGE_PREFERENCES);
  } finally { db.close(); }
});
