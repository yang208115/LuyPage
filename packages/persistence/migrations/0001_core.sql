PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE auth_identities (
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  PRIMARY KEY(provider, issuer, subject)
);
CREATE INDEX auth_identities_owner ON auth_identities(owner_id);
CREATE TABLE workspace_state (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_revision INTEGER NOT NULL DEFAULT 0 CHECK(data_revision >= 0),
  preferences TEXT NOT NULL DEFAULT '{"desktopColumns":"auto","mobileColumns":"auto","density":"comfortable","collapsedGroupIds":[],"autoIcons":false}' CHECK(json_valid(preferences))
);
CREATE TABLE groups (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  PRIMARY KEY(owner_id, id),
  UNIQUE(owner_id, name_key)
);
CREATE INDEX groups_order ON groups(owner_id, position, id);
CREATE TABLE tags (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  PRIMARY KEY(owner_id, id),
  UNIQUE(owner_id, name_key)
);
CREATE TABLE bookmarks (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  note TEXT NOT NULL,
  search_key TEXT NOT NULL,
  group_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
  pinned_position INTEGER NOT NULL CHECK(pinned_position BETWEEN 0 AND 9007199254740991),
  icon_type TEXT NOT NULL CHECK(icon_type IN ('auto', 'builtin')),
  icon_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  PRIMARY KEY(owner_id, id),
  UNIQUE(owner_id, normalized_url),
  FOREIGN KEY(owner_id, group_id) REFERENCES groups(owner_id, id)
);
CREATE INDEX bookmarks_group_order ON bookmarks(owner_id, deleted_at, group_id, position, id);
CREATE INDEX bookmarks_pinned_order ON bookmarks(owner_id, deleted_at, pinned, pinned_position, id);
CREATE INDEX bookmarks_created ON bookmarks(owner_id, deleted_at, pinned, created_at, id);
CREATE INDEX bookmarks_updated ON bookmarks(owner_id, deleted_at, pinned, updated_at, id);
CREATE INDEX bookmarks_title ON bookmarks(owner_id, deleted_at, pinned, title_key, id);
CREATE TABLE bookmark_tags (
  owner_id TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY(owner_id, bookmark_id, tag_id),
  FOREIGN KEY(owner_id, bookmark_id) REFERENCES bookmarks(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id, tag_id) REFERENCES tags(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX bookmark_tags_tag ON bookmark_tags(owner_id, tag_id, bookmark_id);
CREATE TABLE mutation_receipts (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, operation_id)
);
-- Retain receipts until an explicit expiry/tombstone protocol is implemented.
-- Deleting them on a timer would allow an old operation ID to execute again.
CREATE TABLE mutation_guards (
  id TEXT PRIMARY KEY NOT NULL,
  passed INTEGER NOT NULL CHECK(passed = 1)
);
