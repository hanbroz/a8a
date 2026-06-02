import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync } from 'fs'
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
  try {
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    return rows
  } finally {
    stmt.free()
  }
}

function queryOne<T extends object>(sql: string, params: (string | number | null)[] = []): T | null {
  return queryAll<T>(sql, params)[0] ?? null
}

function save(): void {
  const path = dbPath()
  const tmpPath = `${path}.tmp`
  // 임시 파일에 쓰고 fsync로 디스크에 강제 반영한 뒤 원자적으로 교체한다.
  // fsync가 없으면 rename은 반영됐는데 데이터 블록은 미반영된 채 크래시가 나
  // a8a.db가 0바이트/잘린 상태로 남아 전체 DB가 유실될 수 있다.
  const fd = openSync(tmpPath, 'w')
  try {
    writeSync(fd, Buffer.from(db.export()))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmpPath, path)
}

function withTransaction<T>(work: () => T): T {
  db.run('BEGIN')
  try {
    const result = work()
    db.run('COMMIT')
    return result
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

function ensureProjectExists(projectId: string): { id: string; workspace_id: string } {
  const project = queryOne<{ id: string; workspace_id: string }>(
    'SELECT id, workspace_id FROM projects WHERE id = ?',
    [projectId]
  )
  if (!project) throw new Error(`Project ${projectId} not found`)
  return project
}

function ensureWorkspaceExists(workspaceId: string): void {
  const workspace = queryOne<{ id: string }>('SELECT id FROM workspaces WHERE id = ?', [workspaceId])
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)
}

function edgeWouldCreateCycle(projectId: string, sourceNodeId: string, targetNodeId: string): boolean {
  const rows = queryAll<{ source_node_id: string; target_node_id: string }>(
    'SELECT source_node_id, target_node_id FROM edges WHERE project_id = ?',
    [projectId]
  )
  const stack = [targetNodeId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceNodeId) return true
    if (visited.has(current)) continue
    visited.add(current)
    rows
      .filter(e => e.source_node_id === current)
      .forEach(e => stack.push(e.target_node_id))
  }
  return false
}

function allowsMultipleIncoming(type: string): boolean {
  return type === 'api' || type === 'branch'
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
      y          REAL DEFAULT 0,
      width      REAL,
      height     REAL
    );
    CREATE TABLE IF NOT EXISTS edges (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      source_port    TEXT
    );
  `)
  try {
    db.run("ALTER TABLE nodes ADD COLUMN config TEXT DEFAULT ''")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE nodes ADD COLUMN width REAL")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE nodes ADD COLUMN height REAL")
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
  try {
    db.run("ALTER TABLE modules ADD COLUMN sort INTEGER DEFAULT 0")
  } catch { /* column already exists */ }
  // Node module_id migration
  try {
    db.run("ALTER TABLE nodes ADD COLUMN module_id TEXT")
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE edges ADD COLUMN source_port TEXT")
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
  migrateLegacyModuleNodesToStandalone()
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
  withTransaction(() => {
    db.run('INSERT INTO workspaces (id, name, description) VALUES (?, ?, ?)', [id, name, description])
    db.run('INSERT INTO environments (id, workspace_id, name, is_base) VALUES (?, ?, ?, ?)', [envId, id, 'BASE', 1])
  })
  save()
  return { id, name, description }
}

export function updateWorkspace(id: string, name: string, description: string): void {
  db.run('UPDATE workspaces SET name = ?, description = ? WHERE id = ?', [name, description, id])
  save()
}

export function deleteWorkspace(id: string): void {
  withTransaction(() => {
    const projectIds = queryAll<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ?', [id])
    projectIds.forEach(p => {
      db.run('DELETE FROM edges WHERE project_id = ?', [p.id])
      db.run('DELETE FROM nodes WHERE project_id = ?', [p.id])
    })
    const envIds = queryAll<{ id: string }>('SELECT id FROM environments WHERE workspace_id = ?', [id])
    envIds.forEach(e => db.run('DELETE FROM env_vars WHERE environment_id = ?', [e.id]))
    db.run('DELETE FROM modules WHERE workspace_id = ?', [id])
    db.run('DELETE FROM environments WHERE workspace_id = ?', [id])
    db.run('DELETE FROM projects WHERE workspace_id = ?', [id])
    db.run('DELETE FROM workspaces WHERE id = ?', [id])
  })
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
  ensureWorkspaceExists(workspaceId)
  withTransaction(() => {
    const exists = queryOne<{ workspace_id: string; is_base: number }>(
      'SELECT workspace_id, is_base FROM environments WHERE id = ?',
      [env.id]
    )
    if (exists && exists.workspace_id !== workspaceId) {
      throw new Error('다른 워크스페이스의 환경은 수정할 수 없습니다.')
    }
    if (exists) {
      const name = exists.is_base === 1 ? 'BASE' : env.name
      db.run('UPDATE environments SET name = ?, color = ?, initial = ? WHERE id = ?', [name, env.color, env.initial, env.id])
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
  })
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

function nextProjectSort(workspaceId: string): number {
  const row = queryOne<{ max_sort: number | null }>(
    'SELECT MAX(sort) as max_sort FROM projects WHERE workspace_id = ?',
    [workspaceId]
  )
  return (row?.max_sort ?? -1) + 1
}

export function createProject(workspaceId: string, name: string, description: string): ProjectRow {
  ensureWorkspaceExists(workspaceId)
  const id = randomUUID()
  withTransaction(() => {
    db.run(
      'INSERT INTO projects (id, workspace_id, name, description, sort) VALUES (?, ?, ?, ?, ?)',
      [id, workspaceId, name, description, nextProjectSort(workspaceId)]
    )
    db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), id, 'start', 'Start', 80, 160, defaultNodeWidth('start'), defaultNodeHeight('start')])
    db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), id, 'end', 'End', 520, 160, defaultNodeWidth('end'), defaultNodeHeight('end')])
  })
  save()
  return { id, name, description }
}

export function updateProject(id: string, name: string, description: string): void {
  db.run('UPDATE projects SET name = ?, description = ? WHERE id = ?', [name, description, id])
  save()
}

export function deleteProject(id: string): void {
  withTransaction(() => {
    db.run('DELETE FROM edges WHERE project_id = ?', [id])
    db.run('DELETE FROM nodes WHERE project_id = ?', [id])
    db.run('DELETE FROM projects WHERE id = ?', [id])
  })
  save()
}

// ── Node ──────────────────────────────────────────
export function reorderProjects(workspaceId: string, orderedIds: string[]): void {
  ensureWorkspaceExists(workspaceId)
  const current = queryAll<{ id: string }>(
    'SELECT id FROM projects WHERE workspace_id = ? ORDER BY sort, rowid',
    [workspaceId]
  ).map(project => project.id)
  const currentSet = new Set(current)
  if (orderedIds.length !== current.length || orderedIds.some(id => !currentSet.has(id))) {
    throw new Error('같은 워크스페이스의 프로젝트 안에서만 순서를 변경할 수 있습니다.')
  }
  withTransaction(() => {
    orderedIds.forEach((id, index) => {
      db.run('UPDATE projects SET sort = ? WHERE id = ?', [index, id])
    })
  })
  save()
}

export type NodeRow = {
  id: string
  projectId: string
  type: string
  label: string
  x: number
  y: number
  width: number
  height: number
  config: string
}

function defaultNodeWidth(type: string): number {
  return type === 'data' || type === 'select' || type === 'api' || type === 'branch' ? 200 : 160
}

function defaultNodeHeight(type: string): number {
  return type === 'data' || type === 'select' || type === 'api' || type === 'branch' ? 72 : 52
}

function mergeNodeModuleConfig(moduleConfig: string | null, nodeConfig: string | null): string {
  const base = moduleConfig ?? ''
  const override = nodeConfig ?? ''
  if (!override.trim()) return base
  if (!base.trim()) return override
  try {
    const baseJson = JSON.parse(base) as unknown
    const overrideJson = JSON.parse(override) as unknown
    if (
      baseJson &&
      overrideJson &&
      typeof baseJson === 'object' &&
      typeof overrideJson === 'object' &&
      !Array.isArray(baseJson) &&
      !Array.isArray(overrideJson)
    ) {
      return JSON.stringify({ ...(baseJson as Record<string, unknown>), ...(overrideJson as Record<string, unknown>) })
    }
  } catch {
    return override
  }
  return override
}

function migrateLegacyModuleNodesToStandalone(): void {
  const linkedNodes = queryAll<{
    id: string
    type: string
    label: string
    config: string
    mod_type: string | null
    mod_label: string | null
    mod_config: string | null
  }>(
    `SELECT n.id, n.type, n.label, COALESCE(n.config, '') as config,
      m.type as mod_type, m.label as mod_label, m.config as mod_config
     FROM nodes n LEFT JOIN modules m ON n.module_id = m.id
     WHERE n.module_id IS NOT NULL`
  )

  withTransaction(() => {
    linkedNodes.forEach(node => {
      const nextType = node.mod_type ?? node.type
      const nextLabel = node.label.trim() || node.mod_label || node.label || nextType
      const nextConfig = node.mod_config != null
        ? mergeNodeModuleConfig(node.mod_config, node.config)
        : node.config
      db.run(
        'UPDATE nodes SET type = ?, label = ?, config = ?, module_id = NULL WHERE id = ?',
        [nextType, nextLabel, nextConfig, node.id]
      )
    })
    db.run('UPDATE nodes SET module_id = NULL WHERE module_id IS NOT NULL')
    db.run('DELETE FROM modules')
  })
}

function ensureDefaultNodes(projectId: string): void {
  ensureProjectExists(projectId)
  withTransaction(() => {
    db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'start', 'Start', 80, 160, defaultNodeWidth('start'), defaultNodeHeight('start')])
    db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'end', 'End', 520, 160, defaultNodeWidth('end'), defaultNodeHeight('end')])
  })
  save()
}

export function listNodes(projectId: string): NodeRow[] {
  const rows = queryAll<{
    id: string; project_id: string; type: string; label: string; x: number; y: number; width: number | null; height: number | null; config: string
  }>(
    `SELECT id, project_id, type, label, x, y, width, height, COALESCE(config, '') as config
     FROM nodes
     WHERE project_id = ?`,
    [projectId]
  )
  if (rows.length === 0) {
    ensureDefaultNodes(projectId)
    return listNodes(projectId)
  }
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    type: r.type,
    label: r.label,
    x: r.x,
    y: r.y,
    width: r.width ?? defaultNodeWidth(r.type),
    height: r.height ?? defaultNodeHeight(r.type),
    config: r.config
  }))
}

export function createNode(projectId: string, type: string, label: string, x: number, y: number): NodeRow {
  ensureProjectExists(projectId)
  const id = randomUUID()
  const width = defaultNodeWidth(type)
  const height = defaultNodeHeight(type)
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, type, label, x, y, width, height, ''])
  save()
  return { id, projectId, type, label, x, y, width, height, config: '' }
}

export function updateNodePosition(id: string, x: number, y: number): void {
  db.run('UPDATE nodes SET x = ?, y = ? WHERE id = ?', [x, y, id])
  save()
}

export function updateNodeSize(id: string, width: number, height: number): void {
  db.run('UPDATE nodes SET width = ?, height = ? WHERE id = ?', [width, height, id])
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
  withTransaction(() => {
    db.run('DELETE FROM edges WHERE source_node_id = ? OR target_node_id = ?', [id, id])
    db.run('DELETE FROM nodes WHERE id = ?', [id])
  })
  save()
}

// ── Edge ──────────────────────────────────────────
export type EdgeRow = { id: string; projectId: string; sourceNodeId: string; targetNodeId: string; sourcePort: string | null }

export function listEdges(projectId: string): EdgeRow[] {
  return queryAll<{ id: string; project_id: string; source_node_id: string; target_node_id: string; source_port: string | null }>(
    'SELECT id, project_id, source_node_id, target_node_id, source_port FROM edges WHERE project_id = ?',
    [projectId]
  ).map(r => ({ id: r.id, projectId: r.project_id, sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id, sourcePort: r.source_port ?? null }))
}

export function createEdge(projectId: string, sourceNodeId: string, targetNodeId: string, sourcePort?: string | null): EdgeRow {
  if (sourceNodeId === targetNodeId) throw new Error('같은 노드끼리는 연결할 수 없습니다.')
  const endpoints = queryAll<{ id: string; project_id: string; type: string }>(
    'SELECT id, project_id, type FROM nodes WHERE id IN (?, ?)',
    [sourceNodeId, targetNodeId]
  )
  const source = endpoints.find(n => n.id === sourceNodeId)
  const target = endpoints.find(n => n.id === targetNodeId)
  if (!source || !target) throw new Error('연결할 노드를 찾을 수 없습니다.')
  if (source.project_id !== projectId || target.project_id !== projectId) {
    throw new Error('같은 프로젝트의 노드만 연결할 수 있습니다.')
  }
  if (source.type === 'end') throw new Error('End 노드에서는 연결을 시작할 수 없습니다.')
  if (target.type === 'start') throw new Error('Start 노드로는 연결할 수 없습니다.')
  const normalizedSourcePort = source.type === 'branch' ? (sourcePort === 'true' || sourcePort === 'false' ? sourcePort : 'true') : null
  const existing = queryOne<{ id: string; project_id: string; source_node_id: string; target_node_id: string; source_port: string | null }>(
    'SELECT id, project_id, source_node_id, target_node_id, source_port FROM edges WHERE project_id = ? AND source_node_id = ? AND target_node_id = ?',
    [projectId, sourceNodeId, targetNodeId]
  )
  if (existing) {
    return { id: existing.id, projectId: existing.project_id, sourceNodeId: existing.source_node_id, targetNodeId: existing.target_node_id, sourcePort: existing.source_port ?? null }
  }
  const inbound = queryOne<{ id: string }>(
    'SELECT id FROM edges WHERE project_id = ? AND target_node_id = ?',
    [projectId, targetNodeId]
  )
  if (!allowsMultipleIncoming(target.type) && inbound) throw new Error('한 노드에는 하나의 입력 연결만 허용됩니다.')
  const outbound = queryOne<{ id: string }>(
    'SELECT id FROM edges WHERE project_id = ? AND source_node_id = ?',
    [projectId, sourceNodeId]
  )
  if (source.type === 'start' && outbound) throw new Error('Start 노드에는 하나의 출력 연결만 허용됩니다.')
  if (edgeWouldCreateCycle(projectId, sourceNodeId, targetNodeId)) {
    throw new Error('순환 연결은 만들 수 없습니다.')
  }
  const id = randomUUID()
  db.run('INSERT INTO edges (id, project_id, source_node_id, target_node_id, source_port) VALUES (?, ?, ?, ?, ?)', [id, projectId, sourceNodeId, targetNodeId, normalizedSourcePort])
  save()
  return { id, projectId, sourceNodeId, targetNodeId, sourcePort: normalizedSourcePort }
}

export function deleteEdge(id: string): void {
  db.run('DELETE FROM edges WHERE id = ?', [id])
  save()
}

// ── Module ────────────────────────────────────────
export type ModuleRow = { id: string; workspaceId: string | null; type: string; label: string; config: string; isCommon: boolean }

function nextModuleSort(workspaceId: string | null, type: string, isCommon: boolean): number {
  const row = workspaceId === null || isCommon
    ? queryOne<{ max_sort: number | null }>('SELECT MAX(sort) as max_sort FROM modules WHERE workspace_id IS NULL AND is_common = 1 AND type = ?', [type])
    : queryOne<{ max_sort: number | null }>('SELECT MAX(sort) as max_sort FROM modules WHERE workspace_id = ? AND is_common = 0 AND type = ?', [workspaceId, type])
  return (row?.max_sort ?? -1) + 1
}

export function listModules(workspaceId: string): ModuleRow[] {
  ensureWorkspaceExists(workspaceId)
  return []
}

export function listAllModules(): ModuleRow[] {
  return []
}

export function createCommonModule(type: string, label: string, config: string): ModuleRow {
  void type
  void label
  void config
  throw new Error('모듈 등록은 더 이상 지원되지 않습니다. 캔버스에 타입을 드래그해 독립 노드를 생성하세요.')
}

export function createModule(workspaceId: string, type: string, label: string, config: string): ModuleRow {
  ensureWorkspaceExists(workspaceId)
  void type
  void label
  void config
  throw new Error('모듈 등록은 더 이상 지원되지 않습니다. 캔버스에 타입을 드래그해 독립 노드를 생성하세요.')
}

export function updateModule(id: string, label: string, config: string): void {
  void id
  void label
  void config
  throw new Error('모듈 수정은 더 이상 지원되지 않습니다. 캔버스 노드를 직접 수정하세요.')
}

export function setModuleCommon(id: string, isCommon: boolean, workspaceId: string): void {
  void id
  void isCommon
  ensureWorkspaceExists(workspaceId)
  throw new Error('공통 모듈 전환은 더 이상 지원되지 않습니다.')
}

export function reorderCommonModules(type: string, orderedIds: string[]): void {
  void type
  void orderedIds
}

export function deleteModule(id: string): void {
  db.run('DELETE FROM modules WHERE id = ?', [id])
  save()
}

export function createNodeFromModule(projectId: string, moduleId: string, x: number, y: number): NodeRow {
  void projectId
  void moduleId
  void x
  void y
  throw new Error('모듈 참조 생성은 더 이상 지원되지 않습니다. node:create를 사용하세요.')
}
