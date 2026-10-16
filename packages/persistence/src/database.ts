import { AppError, type LayoutPreferences } from '@luypage/contracts';

export interface State { data_revision: number; preferences: string }
export type SqlValue = string | number | null;
export const statement = (db: D1Database, sql: string, ...values: SqlValue[]) => db.prepare(sql).bind(...values);
export const conflict = () => new AppError('VERSION_CONFLICT', '数据已被修改，请刷新后重试。', 409);
export const missing = () => new AppError('NOT_FOUND', '找不到该对象。', 404);
export const preferencesOf = (state: State): LayoutPreferences => JSON.parse(state.preferences) as LayoutPreferences;

export async function readState(db: D1Database, ownerId: string): Promise<State> {
  const state = await statement(db, 'SELECT data_revision, preferences FROM workspace_state WHERE owner_id = ?', ownerId).first<State>();
  if (!state) throw missing();
  return state;
}

export async function ensureIdentity(db: D1Database, identity: { provider: string; issuer: string; subject: string; displayName: string }): Promise<string> {
  const candidate = crypto.randomUUID();
  const key = [identity.provider, identity.issuer, identity.subject];
  // Every existence check executes inside the same serial D1 transaction. A racing
  // initializer observes the committed identity and never creates an orphan user.
  const results = await db.batch([
    statement(db, `INSERT INTO users (id, created_at) SELECT ?, ? WHERE NOT EXISTS
      (SELECT 1 FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?)`, candidate, new Date().toISOString(), ...key),
    statement(db, `INSERT INTO auth_identities (provider, issuer, subject, owner_id, display_name)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
      ON CONFLICT(provider, issuer, subject) DO NOTHING`, ...key, candidate, identity.displayName, candidate),
    statement(db, `INSERT INTO workspace_state (owner_id)
      SELECT owner_id FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?
      ON CONFLICT(owner_id) DO NOTHING`, ...key),
    statement(db, 'SELECT owner_id FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?', ...key),
  ]);
  const row = results[3]?.results[0] as { owner_id: string } | undefined;
  if (!row) throw new Error('Identity initialization failed');
  return row.owner_id;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
async function hashRequest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
async function receipt<T>(db: D1Database, ownerId: string, operationId: string, hash: string): Promise<{ result: T } | null> {
  const row = await statement(db, 'SELECT request_hash, response_json FROM mutation_receipts WHERE owner_id = ? AND operation_id = ?', ownerId, operationId).first<{ request_hash: string; response_json: string }>();
  if (!row) return null;
  if (row.request_hash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT', '该操作编号已用于不同请求，请使用新的操作编号。', 409);
  return { result: JSON.parse(row.response_json) as T };
}

export interface MutationPlan<T> { statements: D1PreparedStatement[]; result: T }
export async function mutate<T>(db: D1Database, ownerId: string, operationId: string, request: unknown,
  plan: (state: State) => Promise<MutationPlan<T>>, baseRevision?: number): Promise<T> {
  const hash = await hashRequest(request);
  for (let attempt = 0; attempt < 6; attempt++) {
    const saved = await receipt<T>(db, ownerId, operationId, hash);
    if (saved) return saved.result;
    const state = await readState(db, ownerId);
    if (baseRevision !== undefined && state.data_revision !== baseRevision) throw conflict();
    try {
      const next = await plan(state);
      const guardId = crypto.randomUUID();
      await db.batch([
        // VALUES always inserts one row. INSERT ... SELECT ... WHERE would allow a
        // failed condition to insert zero rows and accidentally commit the writes.
        statement(db, `INSERT INTO mutation_guards (id, passed) VALUES (?, CASE WHEN EXISTS
          (SELECT 1 FROM workspace_state WHERE owner_id = ? AND data_revision = ?) THEN 1 ELSE 0 END)`, guardId, ownerId, state.data_revision),
        ...next.statements,
        statement(db, 'UPDATE workspace_state SET data_revision = data_revision + 1 WHERE owner_id = ?', ownerId),
        statement(db, 'INSERT INTO mutation_receipts (owner_id, operation_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)', ownerId, operationId, hash, JSON.stringify(next.result), new Date().toISOString()),
        statement(db, 'DELETE FROM mutation_guards WHERE id = ?', guardId),
      ]);
      return next.result;
    } catch (error) {
      // Resolve a lost/racing response before looking at the now-outdated version.
      const saved = await receipt<T>(db, ownerId, operationId, hash);
      if (saved) return saved.result;
      const latest = await readState(db, ownerId);
      if (latest.data_revision !== state.data_revision) {
        if (baseRevision !== undefined) throw conflict();
        continue;
      }
      if (error instanceof AppError) throw error;
      throw new AppError('STORAGE_UNAVAILABLE', '保存失败，数据未提交；请使用相同操作编号重试。', 503);
    }
  }
  throw conflict();
}
