import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'

let db: Database
let dbFilePath: string

function dbPath(): string {
  if (!dbFilePath) dbFilePath = join(app.getPath('userData'), 'a8a.db')
  return dbFilePath
}

function wasmDir(): string {
  const candidates = [
    join(app.getAppPath(), 'node_modules/sql.js/dist'),
    join(__dirname, '../../node_modules/sql.js/dist'),
    join(process.cwd(), 'node_modules/sql.js/dist')
  ]
  return candidates.find(p => existsSync(join(p, 'sql-wasm.wasm'))) ?? candidates[0]
}

function queryAll<T extends object>(sql: string, params: (string | number | null)[] = []): T[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function queryOne<T extends object>(sql: string, params: (string | number | null)[] = []): T | null {
  return queryAll<T>(sql, params)[0] ?? null
}

function save(): void {
  writeFileSync(dbPath(), Buffer.from(db.export()))
}

// ── Init ──────────────────────────────────────────
export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir(), f) })
  const path = dbPath()
  db = existsSync(path) ? new SQL.Database(readFileSync(path)) : new SQL.Database()
  db.run('PRAGMA foreign_keys = ON')
  createSchema()
  seedIfEmpty()
  save()
}

function createSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS environments (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name         TEXT NOT NULL,
      is_base      INTEGER DEFAULT 0,
      color        TEXT DEFAULT '#4493f8',
      sort         INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS env_vars (
      id             TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      key            TEXT NOT NULL,
      value          TEXT DEFAULT '',
      enabled        INTEGER DEFAULT 1,
      sort           INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT DEFAULT '',
      sort         INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS modules (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT,
      type         TEXT NOT NULL DEFAULT 'data',
      label        TEXT NOT NULL DEFAULT '',
      config       TEXT DEFAULT '',
      is_common    INTEGER DEFAULT 0,
      sort         INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type       TEXT NOT NULL,
      label      TEXT NOT NULL,
      x          REAL DEFAULT 0,
      y          REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS edges (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL
    );
  `)
  try {
    db.run("ALTER TABLE nodes ADD COLUMN config TEXT DEFAULT ''")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE environments ADD COLUMN color TEXT DEFAULT '#4493f8'")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE workspaces ADD COLUMN description TEXT DEFAULT ''")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE environments ADD COLUMN initial TEXT DEFAULT ''")
  } catch { /* column already exists */ }
  // Module column migrations
  try {
    db.run("ALTER TABLE modules ADD COLUMN workspace_id TEXT")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE modules ADD COLUMN type TEXT NOT NULL DEFAULT 'data'")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE modules ADD COLUMN label TEXT NOT NULL DEFAULT ''")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE modules ADD COLUMN config TEXT DEFAULT ''")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE modules ADD COLUMN is_common INTEGER DEFAULT 0")
  } catch { /* column already exists */ }
  // Node module_id migration
  try {
    db.run("ALTER TABLE nodes ADD COLUMN module_id TEXT")
  } catch { /* column already exists */ }
  // Remove legacy 'name' NOT NULL column from modules if it exists
  try {
    const cols = db.exec('PRAGMA table_info(modules)') as Array<{ values: unknown[][] }>
    const hasName = cols.length > 0 && cols[0].values.some((row) => row[1] === 'name')
    if (hasName) {
      db.run('BEGIN')
      try {
        db.run(`CREATE TABLE modules_v2 (
          id           TEXT PRIMARY KEY,
          workspace_id TEXT,
          type         TEXT NOT NULL DEFAULT 'data',
          label        TEXT NOT NULL DEFAULT '',
          config       TEXT DEFAULT '',
          is_common    INTEGER DEFAULT 0,
          sort         INTEGER DEFAULT 0
        )`)
        db.run(`INSERT INTO modules_v2 SELECT id, workspace_id, type, COALESCE(NULLIF(label,''), name, '') as label, COALESCE(config,'') as config, COALESCE(is_common,0) as is_common, COALESCE(sort,0) as sort FROM modules`)
        db.run('DROP TABLE modules')
        db.run('ALTER TABLE modules_v2 RENAME TO modules')
        db.run('COMMIT')
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
    }
  } catch { /* migration failed, continue */ }
}

function seedIfEmpty(): void {
  const row = queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM workspaces')
  if ((row?.cnt ?? 0) > 0) return
  const wsId = randomUUID()
  const envId = randomUUID()
  db.run('INSERT INTO workspaces (id, name) VALUES (?, ?)', [wsId, '기본 워크스페이스'])
  db.run('INSERT INTO environments (id, workspace_id, name, is_base) VALUES (?, ?, ?, ?)', [envId, wsId, 'BASE', 1])
}

// ── Workspace ─────────────────────────────────────
export type WsRow = { id: string; name: string; description: string }

export function listWorkspaces(): WsRow[] {
  return queryAll<WsRow>('SELECT id, name, COALESCE(description, \'\') as description FROM workspaces ORDER BY sort, rowid')
}

export function createWorkspace(name: string, description = ''): WsRow {
  const id = randomUUID()
  const envId = randomUUID()
  db.run('INSERT INTO workspaces (id, name, description) VALUES (?, ?, ?)', [id, name, description])
  db.run('INSERT INTO environments (id, workspace_id, name, is_base) VALUES (?, ?, ?, ?)', [envId, id, 'BASE', 1])
  save()
  return { id, name, description }
}

export function updateWorkspace(id: string, name: string, description: string): void {
  db.run('UPDATE workspaces SET name = ?, description = ? WHERE id = ?', [name, description, id])
  save()
}

export function deleteWorkspace(id: string): void {
  const envIds = queryAll<{ id: string }>('SELECT id FROM environments WHERE workspace_id = ?', [id])
  envIds.forEach(e => db.run('DELETE FROM env_vars WHERE environment_id = ?', [e.id]))
  db.run('DELETE FROM environments WHERE workspace_id = ?', [id])
  db.run('DELETE FROM projects WHERE workspace_id = ?', [id])
  db.run('DELETE FROM workspaces WHERE id = ?', [id])
  save()
}

// ── Environment ───────────────────────────────────
export type EnvVarRow = { id: string; key: string; value: string; enabled: boolean }
export type EnvRow = { id: string; name: string; isBase: boolean; color: string; initial: string; vars: EnvVarRow[] }

export function listEnvironments(workspaceId: string): EnvRow[] {
  const envs = queryAll<{ id: string; name: string; is_base: number; color: string; initial: string }>(
    'SELECT id, name, is_base, color, COALESCE(initial, \'\') as initial FROM environments WHERE workspace_id = ? ORDER BY is_base DESC, sort, rowid',
    [workspaceId]
  )
  return envs.map(e => ({
    id: e.id,
    name: e.name,
    isBase: e.is_base === 1,
    color: e.color ?? '#4493f8',
    initial: e.initial ?? '',
    vars: queryAll<{ id: string; key: string; value: string; enabled: number }>(
      'SELECT id, key, value, enabled FROM env_vars WHERE environment_id = ? ORDER BY sort, rowid',
      [e.id]
    ).map(v => ({ id: v.id, key: v.key, value: v.value, enabled: v.enabled === 1 }))
  }))
}

export function upsertEnvironment(workspaceId: string, env: EnvRow): void {
  const exists = queryOne('SELECT id FROM environments WHERE id = ?', [env.id])
  if (exists) {
    db.run('UPDATE environments SET name = ?, color = ?, initial = ? WHERE id = ?', [env.name, env.color, env.initial, env.id])
  } else {
    db.run(
      'INSERT INTO environments (id, workspace_id, name, is_base, color, initial) VALUES (?, ?, ?, ?, ?, ?)',
      [env.id, workspaceId, env.name, env.isBase ? 1 : 0, env.color, env.initial]
    )
  }
  db.run('DELETE FROM env_vars WHERE environment_id = ?', [env.id])
  env.vars.forEach((v, i) =>
    db.run(
      'INSERT INTO env_vars (id, environment_id, key, value, enabled, sort) VALUES (?, ?, ?, ?, ?, ?)',
      [v.id, env.id, v.key, v.value, v.enabled ? 1 : 0, i]
    )
  )
  save()
}

export function deleteEnvironment(id: string): void {
  db.run('DELETE FROM env_vars WHERE environment_id = ? AND environment_id IN (SELECT id FROM environments WHERE is_base = 0)', [id])
  db.run('DELETE FROM environments WHERE id = ? AND is_base = 0', [id])
  save()
}

// ── Project ───────────────────────────────────────
export type ProjectRow = { id: string; name: string; description: string }

export function listProjects(workspaceId: string): ProjectRow[] {
  return queryAll<ProjectRow>(
    'SELECT id, name, description FROM projects WHERE workspace_id = ? ORDER BY sort, rowid',
    [workspaceId]
  )
}

export function createProject(workspaceId: string, name: string, description: string): ProjectRow {
  const id = randomUUID()
  db.run('INSERT INTO projects (id, workspace_id, name, description) VALUES (?, ?, ?, ?)', [id, workspaceId, name, description])
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), id, 'start', 'Start', 80, 160])
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), id, 'end', 'End', 520, 160])
  save()
  return { id, name, description }
}

export function updateProject(id: string, name: string, description: string): void {
  db.run('UPDATE projects SET name = ?, description = ? WHERE id = ?', [name, description, id])
  save()
}

export function deleteProject(id: string): void {
  db.run('DELETE FROM edges WHERE project_id = ?', [id])
  db.run('DELETE FROM nodes WHERE project_id = ?', [id])
  db.run('DELETE FROM projects WHERE id = ?', [id])
  save()
}

// ── Node ──────────────────────────────────────────
export type NodeRow = { id: string; projectId: string; type: string; label: string; x: number; y: number; config: string; moduleId: string | null }

function ensureDefaultNodes(projectId: string): void {
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'start', 'Start', 80, 160])
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'end', 'End', 520, 160])
  save()
}

export function listNodes(projectId: string): NodeRow[] {
  const rows = queryAll<{
    id: string; project_id: string; type: string; label: string; x: number; y: number; config: string; module_id: string | null;
    mod_type: string | null; mod_label: string | null; mod_config: string | null
  }>(
    `SELECT n.id, n.project_id, n.type, n.label, n.x, n.y, COALESCE(n.config, '') as config, n.module_id,
      m.type as mod_type, m.label as mod_label, m.config as mod_config
     FROM nodes n LEFT JOIN modules m ON n.module_id = m.id
     WHERE n.project_id = ?`,
    [projectId]
  )
  if (rows.length === 0) {
    ensureDefaultNodes(projectId)
    return listNodes(projectId)
  }
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    type: r.module_id && r.mod_type ? r.mod_type : r.type,
    label: r.module_id && r.mod_label != null ? r.mod_label : r.label,
    x: r.x,
    y: r.y,
    config: r.module_id && r.mod_config != null ? r.mod_config : r.config,
    moduleId: r.module_id ?? null
  }))
}

export function createNode(projectId: string, type: string, label: string, x: number, y: number): NodeRow {
  const id = randomUUID()
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y, config) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, projectId, type, label, x, y, ''])
  save()
  return { id, projectId, type, label, x, y, config: '', moduleId: null }
}

export function updateNodePosition(id: string, x: number, y: number): void {
  db.run('UPDATE nodes SET x = ?, y = ? WHERE id = ?', [x, y, id])
  save()
}

export function updateNodeLabel(id: string, label: string): void {
  db.run('UPDATE nodes SET label = ? WHERE id = ?', [label, id])
  save()
}

export function updateNodeConfig(id: string, config: string): void {
  db.run('UPDATE nodes SET config = ? WHERE id = ?', [config, id])
  save()
}

export function deleteNode(id: string): void {
  db.run('DELETE FROM edges WHERE source_node_id = ? OR target_node_id = ?', [id, id])
  db.run('DELETE FROM nodes WHERE id = ?', [id])
  save()
}

// ── Edge ──────────────────────────────────────────
export type EdgeRow = { id: string; projectId: string; sourceNodeId: string; targetNodeId: string }

export function listEdges(projectId: string): EdgeRow[] {
  return queryAll<{ id: string; project_id: string; source_node_id: string; target_node_id: string }>(
    'SELECT id, project_id, source_node_id, target_node_id FROM edges WHERE project_id = ?',
    [projectId]
  ).map(r => ({ id: r.id, projectId: r.project_id, sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id }))
}

export function createEdge(projectId: string, sourceNodeId: string, targetNodeId: string): EdgeRow {
  const id = randomUUID()
  db.run('INSERT INTO edges (id, project_id, source_node_id, target_node_id) VALUES (?, ?, ?, ?)', [id, projectId, sourceNodeId, targetNodeId])
  save()
  return { id, projectId, sourceNodeId, targetNodeId }
}

export function deleteEdge(id: string): void {
  db.run('DELETE FROM edges WHERE id = ?', [id])
  save()
}

// ── Module ────────────────────────────────────────
export type ModuleRow = { id: string; workspaceId: string | null; type: string; label: string; config: string; isCommon: boolean }

export function listModules(workspaceId: string): ModuleRow[] {
  const rows = queryAll<{ id: string; workspace_id: string | null; type: string; label: string; config: string; is_common: number }>(
    'SELECT id, workspace_id, type, label, COALESCE(config, \'\') as config, is_common FROM modules WHERE workspace_id = ? OR is_common = 1 ORDER BY sort, rowid',
    [workspaceId]
  )
  return rows.map(r => ({ id: r.id, workspaceId: r.workspace_id, type: r.type, label: r.label, config: r.config, isCommon: r.is_common === 1 }))
}

export function listAllModules(): ModuleRow[] {
  const rows = queryAll<{ id: string; workspace_id: string | null; type: string; label: string; config: string; is_common: number }>(
    'SELECT id, workspace_id, type, label, COALESCE(config, \'\') as config, is_common FROM modules ORDER BY sort, rowid'
  )
  return rows.map(r => ({ id: r.id, workspaceId: r.workspace_id, type: r.type, label: r.label, config: r.config, isCommon: r.is_common === 1 }))
}

export function createCommonModule(type: string, label: string, config: string): ModuleRow {
  const id = randomUUID()
  db.run('INSERT INTO modules (id, workspace_id, type, label, config, is_common) VALUES (?, NULL, ?, ?, ?, 1)', [id, type, label, config])
  save()
  return { id, workspaceId: null, type, label, config, isCommon: true }
}

export function createModule(workspaceId: string, type: string, label: string, config: string): ModuleRow {
  const id = randomUUID()
  db.run('INSERT INTO modules (id, workspace_id, type, label, config, is_common) VALUES (?, ?, ?, ?, ?, 0)', [id, workspaceId, type, label, config])
  save()
  return { id, workspaceId, type, label, config, isCommon: false }
}

export function updateModule(id: string, label: string, config: string): void {
  db.run('UPDATE modules SET label = ?, config = ? WHERE id = ?', [label, config, id])
  save()
}

export function setModuleCommon(id: string, isCommon: boolean, workspaceId: string): void {
  if (isCommon) {
    db.run('UPDATE modules SET is_common = 1, workspace_id = NULL WHERE id = ?', [id])
  } else {
    db.run('UPDATE modules SET is_common = 0, workspace_id = ? WHERE id = ?', [workspaceId, id])
  }
  save()
}

export function deleteModule(id: string): void {
  db.run('DELETE FROM nodes WHERE module_id = ?', [id])
  db.run('DELETE FROM modules WHERE id = ?', [id])
  save()
}

export function createNodeFromModule(projectId: string, moduleId: string, x: number, y: number): NodeRow {
  const mod = queryOne<{ type: string; label: string; config: string }>(
    'SELECT type, label, COALESCE(config, \'\') as config FROM modules WHERE id = ?',
    [moduleId]
  )
  if (!mod) throw new Error(`Module ${moduleId} not found`)
  const id = randomUUID()
  db.run(
    'INSERT INTO nodes (id, project_id, type, label, x, y, config, module_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, mod.type, mod.label, x, y, '', moduleId]
  )
  save()
  return { id, projectId, type: mod.type, label: mod.label, x, y, config: mod.config, moduleId }
}
