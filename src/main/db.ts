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
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0
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
export type NodeRow = { id: string; projectId: string; type: string; label: string; x: number; y: number; config: string }

function ensureDefaultNodes(projectId: string): void {
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'start', 'Start', 80, 160])
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'end', 'End', 520, 160])
  save()
}

export function listNodes(projectId: string): NodeRow[] {
  const rows = queryAll<{ id: string; project_id: string; type: string; label: string; x: number; y: number; config: string }>(
    'SELECT id, project_id, type, label, x, y, COALESCE(config, \'\') as config FROM nodes WHERE project_id = ?',
    [projectId]
  )
  if (rows.length === 0) {
    ensureDefaultNodes(projectId)
    return listNodes(projectId)
  }
  return rows.map(r => ({ id: r.id, projectId: r.project_id, type: r.type, label: r.label, x: r.x, y: r.y, config: r.config }))
}

export function updateNodePosition(id: string, x: number, y: number): void {
  db.run('UPDATE nodes SET x = ?, y = ? WHERE id = ?', [x, y, id])
  save()
}

export function updateNodeConfig(id: string, config: string): void {
  db.run('UPDATE nodes SET config = ? WHERE id = ?', [config, id])
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
export type ModuleRow = { id: string; name: string }

export function listModules(): ModuleRow[] {
  return queryAll<ModuleRow>('SELECT id, name FROM modules ORDER BY sort, rowid')
}

export function createModule(name: string): ModuleRow {
  const id = randomUUID()
  db.run('INSERT INTO modules (id, name) VALUES (?, ?)', [id, name])
  save()
  return { id, name }
}

export function renameModule(id: string, name: string): void {
  db.run('UPDATE modules SET name = ? WHERE id = ?', [name, id])
  save()
}

export function deleteModule(id: string): void {
  db.run('DELETE FROM modules WHERE id = ?', [id])
  save()
}
