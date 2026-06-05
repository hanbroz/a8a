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
  return type === 'api' || type === 'branch' || type === 'end'
}

function normalizeEdgeSourcePort(sourceType: string, sourcePort?: string | null): string | null {
  if (sourceType !== 'branch') return null
  return sourcePort === 'false' ? 'false' : 'true'
}

const VALID_NODE_TYPES = new Set(['start', 'end', 'data', 'select', 'api', 'branch'])

type GraphNodeForValidation = Pick<NodeRow, 'id' | 'type'>
type GraphEdgeForValidation = Pick<EdgeRow, 'id' | 'sourceNodeId' | 'targetNodeId' | 'sourcePort'>

function graphEdgesCreateCycle(edges: GraphEdgeForValidation[], sourceNodeId: string, targetNodeId: string): boolean {
  const stack = [targetNodeId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceNodeId) return true
    if (visited.has(current)) continue
    visited.add(current)
    edges
      .filter(edge => edge.sourceNodeId === current)
      .forEach(edge => stack.push(edge.targetNodeId))
  }
  return false
}

function validateProjectGraph(projectId: string, nodes: GraphNodeForValidation[], edges: GraphEdgeForValidation[]): EdgeRow[] {
  const nodeById = new Map<string, GraphNodeForValidation>()
  nodes.forEach(node => {
    if (!node.id.trim()) throw new Error('캔버스 스냅샷에 ID가 없는 노드가 있습니다.')
    if (nodeById.has(node.id)) throw new Error('캔버스 스냅샷에 중복된 노드가 있습니다.')
    if (!VALID_NODE_TYPES.has(node.type)) throw new Error(`지원하지 않는 모듈 타입입니다: ${node.type}`)
    nodeById.set(node.id, node)
  })
  if (nodeById.size === 0) {
    throw new Error('캔버스 스냅샷의 노드 정보가 올바르지 않습니다.')
  }

  const edgeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const inboundCounts = new Map<string, number>()
  const startOutboundCounts = new Map<string, number>()
  const normalizedEdges: EdgeRow[] = []

  edges.forEach(edge => {
    if (!edge.id.trim()) throw new Error('캔버스 스냅샷에 ID가 없는 연결선이 있습니다.')
    if (edgeIds.has(edge.id)) throw new Error('캔버스 스냅샷에 중복된 연결선이 있습니다.')
    edgeIds.add(edge.id)

    if (edge.sourceNodeId === edge.targetNodeId) throw new Error('같은 노드끼리는 연결할 수 없습니다.')
    const source = nodeById.get(edge.sourceNodeId)
    const target = nodeById.get(edge.targetNodeId)
    if (!source || !target) throw new Error('캔버스 스냅샷의 연결선 정보가 올바르지 않습니다.')
    if (source.type === 'end') throw new Error('End 노드에서는 연결을 시작할 수 없습니다.')
    if (target.type === 'start') throw new Error('Start 노드로는 연결할 수 없습니다.')

    const normalizedSourcePort = normalizeEdgeSourcePort(source.type, edge.sourcePort)
    const edgeKey = `${edge.sourceNodeId}\u0000${edge.targetNodeId}\u0000${normalizedSourcePort ?? ''}`
    if (edgeKeys.has(edgeKey)) throw new Error('캔버스 스냅샷에 중복된 연결이 있습니다.')
    edgeKeys.add(edgeKey)

    const inboundCount = (inboundCounts.get(edge.targetNodeId) ?? 0) + 1
    inboundCounts.set(edge.targetNodeId, inboundCount)
    if (!allowsMultipleIncoming(target.type) && inboundCount > 1) {
      throw new Error('한 노드에는 하나의 입력 연결만 허용됩니다.')
    }

    if (source.type === 'start') {
      const outboundCount = (startOutboundCounts.get(edge.sourceNodeId) ?? 0) + 1
      startOutboundCounts.set(edge.sourceNodeId, outboundCount)
      if (outboundCount > 1) throw new Error('Start 노드에는 하나의 출력 연결만 허용됩니다.')
    }

    if (graphEdgesCreateCycle(normalizedEdges, edge.sourceNodeId, edge.targetNodeId)) {
      throw new Error('순환 연결은 만들 수 없습니다.')
    }

    normalizedEdges.push({
      id: edge.id,
      projectId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourcePort: normalizedSourcePort,
    })
  })

  return normalizedEdges
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

export function duplicateProject(id: string, name: string): ProjectRow {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('프로젝트 이름을 입력하세요.')

  const projects = queryAll<{ id: string; workspace_id: string; name: string; description: string; sort: number | null }>(
    'SELECT id, workspace_id, name, COALESCE(description, \'\') as description, sort FROM projects WHERE workspace_id = (SELECT workspace_id FROM projects WHERE id = ?) ORDER BY sort, rowid',
    [id]
  )
  const sourceIndex = projects.findIndex(project => project.id === id)
  const sourceProject = projects[sourceIndex]
  if (!sourceProject) throw new Error(`Project ${id} not found`)

  const cloneId = randomUUID()
  const insertIndex = sourceIndex + 1
  const sourceNodes = queryAll<{
    id: string
    type: string
    label: string
    x: number
    y: number
    width: number | null
    height: number | null
    config: string
  }>(
    `SELECT id, type, label, x, y, width, height, COALESCE(config, '') as config
     FROM nodes
     WHERE project_id = ?
     ORDER BY rowid`,
    [id]
  )
  const sourceEdges = queryAll<{ source_node_id: string; target_node_id: string; source_port: string | null }>(
    'SELECT source_node_id, target_node_id, source_port FROM edges WHERE project_id = ? ORDER BY rowid',
    [id]
  )
  const nodeIdMap = new Map<string, string>()
  const cloneNodes: NodeRow[] = sourceNodes.map(node => {
    const newNodeId = randomUUID()
    nodeIdMap.set(node.id, newNodeId)
    return {
      id: newNodeId,
      projectId: cloneId,
      type: node.type as NodeRow['type'],
      label: node.label,
      x: node.x,
      y: node.y,
      width: node.width ?? defaultNodeWidth(node.type),
      height: node.height ?? defaultNodeHeight(node.type),
      config: node.config,
    }
  })
  const cloneEdges = validateProjectGraph(
    cloneId,
    cloneNodes,
    sourceEdges.flatMap(edge => {
      const sourceNodeId = nodeIdMap.get(edge.source_node_id)
      const targetNodeId = nodeIdMap.get(edge.target_node_id)
      return sourceNodeId && targetNodeId
        ? [{
            id: randomUUID(),
            projectId: cloneId,
            sourceNodeId,
            targetNodeId,
            sourcePort: edge.source_port ?? null,
          }]
        : []
    })
  )

  withTransaction(() => {
    projects.forEach((project, index) => {
      const nextSort = index >= insertIndex ? index + 1 : index
      db.run('UPDATE projects SET sort = ? WHERE id = ?', [nextSort, project.id])
    })
    db.run(
      'INSERT INTO projects (id, workspace_id, name, description, sort) VALUES (?, ?, ?, ?, ?)',
      [cloneId, sourceProject.workspace_id, trimmedName, sourceProject.description, insertIndex]
    )

    cloneNodes.forEach(node => {
      db.run(
        'INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          node.id,
          cloneId,
          node.type,
          node.label,
          node.x,
          node.y,
          node.width,
          node.height,
          node.config,
        ]
      )
    })

    cloneEdges.forEach(edge => {
      db.run(
        'INSERT INTO edges (id, project_id, source_node_id, target_node_id, source_port) VALUES (?, ?, ?, ?, ?)',
        [edge.id, cloneId, edge.sourceNodeId, edge.targetNodeId, edge.sourcePort]
      )
    })
  })
  save()

  return { id: cloneId, name: trimmedName, description: sourceProject.description }
}

// ── 프로젝트 순서 ─────────────────────────────────────
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

function defaultNodeConfig(type: string): string {
  if (type !== 'api') return ''
  return JSON.stringify({
    method: 'GET',
    url: '',
    headers: [
      { id: randomUUID(), key: 'Content-Type', value: 'application/json', enabled: true },
    ],
    params: [],
    body: '',
    bodyType: 'json',
    auth: { type: 'noAuth', addTo: 'header' },
    preScript: '',
    postScript: '',
    inputMappings: {},
  })
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
    db.run("DELETE FROM modules WHERE NOT (workspace_id IS NULL AND is_common = 1 AND type = 'data')")
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
  const config = defaultNodeConfig(type)
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, type, label, x, y, width, height, config])
  save()
  return { id, projectId, type, label, x, y, width, height, config }
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
  const normalizedSourcePort = normalizeEdgeSourcePort(source.type, sourcePort)
  const existingEdges = queryAll<{ id: string; project_id: string; source_node_id: string; target_node_id: string; source_port: string | null }>(
    'SELECT id, project_id, source_node_id, target_node_id, source_port FROM edges WHERE project_id = ? AND source_node_id = ? AND target_node_id = ?',
    [projectId, sourceNodeId, targetNodeId]
  )
  const existing = existingEdges.find(edge => normalizeEdgeSourcePort(source.type, edge.source_port) === normalizedSourcePort)
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

export function replaceProjectCanvas(projectId: string, nodes: NodeRow[], edges: EdgeRow[]): void {
  ensureProjectExists(projectId)
  const normalizedNodes = nodes.map(node => ({
    ...node,
    projectId,
    width: node.width ?? defaultNodeWidth(node.type),
    height: node.height ?? defaultNodeHeight(node.type),
    config: node.config ?? '',
  }))
  const normalizedEdges = validateProjectGraph(projectId, normalizedNodes, edges)

  withTransaction(() => {
    db.run('DELETE FROM edges WHERE project_id = ?', [projectId])
    db.run('DELETE FROM nodes WHERE project_id = ?', [projectId])
    normalizedNodes.forEach(node => {
      db.run(
        'INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          node.id,
          projectId,
          node.type,
          node.label,
          node.x,
          node.y,
          node.width,
          node.height,
          node.config,
        ]
      )
    })
    normalizedEdges.forEach(edge => {
      db.run(
        'INSERT INTO edges (id, project_id, source_node_id, target_node_id, source_port) VALUES (?, ?, ?, ?, ?)',
        [edge.id, projectId, edge.sourceNodeId, edge.targetNodeId, edge.sourcePort]
      )
    })
  })
  save()
}

// ── Module ────────────────────────────────────────
export type ModuleRow = { id: string; workspaceId: string | null; type: string; label: string; config: string; isCommon: boolean }

function mapModuleRow(row: { id: string; workspace_id: string | null; type: string; label: string; config: string; is_common: number }): ModuleRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    label: row.label,
    config: row.config ?? '',
    isCommon: row.is_common === 1,
  }
}

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
  return queryAll<{ id: string; workspace_id: string | null; type: string; label: string; config: string; is_common: number }>(
    `SELECT id, workspace_id, type, label, COALESCE(config, '') as config, is_common
     FROM modules
     WHERE workspace_id IS NULL AND is_common = 1 AND type = 'data'
     ORDER BY type, sort, rowid`
  ).map(mapModuleRow)
}

export function createCommonModule(type: string, label: string, config: string): ModuleRow {
  if (type !== 'data') {
    throw new Error('DATA 모듈만 공용 모듈로 등록할 수 있습니다.')
  }
  const id = randomUUID()
  const nextLabel = label.trim() || 'DATA'
  const sort = nextModuleSort(null, type, true)
  db.run(
    'INSERT INTO modules (id, workspace_id, type, label, config, is_common, sort) VALUES (?, NULL, ?, ?, ?, 1, ?)',
    [id, type, nextLabel, config, sort]
  )
  save()
  return { id, workspaceId: null, type, label: nextLabel, config, isCommon: true }
}

export function createModule(workspaceId: string, type: string, label: string, config: string): ModuleRow {
  ensureWorkspaceExists(workspaceId)
  void type
  void label
  void config
  throw new Error('모듈 등록은 더 이상 지원되지 않습니다. 캔버스에 타입을 드래그해 독립 노드를 생성하세요.')
}

export function updateModule(id: string, label: string, config: string): void {
  const mod = queryOne<{ id: string; type: string; is_common: number }>(
    'SELECT id, type, is_common FROM modules WHERE id = ?',
    [id]
  )
  if (!mod || mod.type !== 'data' || mod.is_common !== 1) {
    throw new Error('공용 DATA 모듈만 수정할 수 있습니다.')
  }
  db.run('UPDATE modules SET label = ?, config = ? WHERE id = ?', [label.trim() || 'DATA', config, id])
  save()
}

export function setModuleCommon(id: string, isCommon: boolean, workspaceId: string): void {
  void id
  void isCommon
  ensureWorkspaceExists(workspaceId)
  throw new Error('공통 모듈 전환은 더 이상 지원되지 않습니다.')
}

export function reorderCommonModules(type: string, orderedIds: string[]): void {
  if (type === 'data') {
    withTransaction(() => {
      orderedIds.forEach((id, index) => {
        db.run(
          "UPDATE modules SET sort = ? WHERE id = ? AND workspace_id IS NULL AND is_common = 1 AND type = 'data'",
          [index, id]
        )
      })
    })
    save()
    return
  }
  void type
  void orderedIds
}

export function deleteModule(id: string): void {
  db.run('DELETE FROM modules WHERE id = ?', [id])
  save()
}

export function createNodeFromModule(projectId: string, moduleId: string, x: number, y: number): NodeRow {
  ensureProjectExists(projectId)
  const mod = queryOne<{ id: string; label: string; type: string; is_common: number }>(
    'SELECT id, label, type, is_common FROM modules WHERE id = ?',
    [moduleId]
  )
  if (!mod || mod.type !== 'data' || mod.is_common !== 1) {
    throw new Error('공용 DATA 모듈만 캔버스에 배치할 수 있습니다.')
  }
  const id = randomUUID()
  const type = 'data'
  const label = mod.label.trim() || 'DATA'
  const width = defaultNodeWidth(type)
  const height = defaultNodeHeight(type)
  const config = JSON.stringify({ sharedDataModuleId: moduleId })
  db.run(
    'INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, type, label, x, y, width, height, config]
  )
  save()
  return { id, projectId, type, label, x, y, width, height, config }
}

// ── Import / Export ───────────────────────────────
export type TransferScope = 'workspace' | 'project'

export type TransferProject = ProjectRow & {
  nodes: NodeRow[]
  edges: EdgeRow[]
}

export type TransferWorkspace = WsRow & {
  environments: EnvRow[]
  projects: TransferProject[]
}

export type TransferPayload = {
  format: 'a8a.export'
  version: 1
  scope: TransferScope
  exportedAt: string
  modules: ModuleRow[]
  workspace?: TransferWorkspace
  project?: TransferProject
}

export type TransferImportResult = {
  scope: TransferScope
  workspaceId?: string
  workspaceName?: string
  projectId?: string
  projectName?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readSharedDataModuleId(config: string): string | null {
  try {
    const parsed = JSON.parse(config || '{}') as Record<string, unknown>
    return typeof parsed.sharedDataModuleId === 'string' && parsed.sharedDataModuleId.trim()
      ? parsed.sharedDataModuleId.trim()
      : null
  } catch {
    return null
  }
}

function remapSharedDataModuleConfig(config: string, moduleIdMap: Map<string, string>): string {
  try {
    const parsed = JSON.parse(config || '{}') as Record<string, unknown>
    const sharedModuleId = typeof parsed.sharedDataModuleId === 'string' ? parsed.sharedDataModuleId : ''
    const nextSharedModuleId = moduleIdMap.get(sharedModuleId)
    if (!nextSharedModuleId) return config ?? ''
    parsed.sharedDataModuleId = nextSharedModuleId
    return JSON.stringify(parsed)
  } catch {
    return config ?? ''
  }
}

function uniqueImportedName(baseName: string, existingNames: Set<string>, fallback: string): string {
  const base = baseName.trim() || fallback
  if (!existingNames.has(base)) {
    existingNames.add(base)
    return base
  }
  let index = 1
  while (true) {
    const candidate = `${base} (가져오기${index === 1 ? '' : ` ${index}`})`
    if (!existingNames.has(candidate)) {
      existingNames.add(candidate)
      return candidate
    }
    index += 1
  }
}

function exportProjectShape(projectId: string): TransferProject {
  const project = queryOne<{ id: string; name: string; description: string }>(
    'SELECT id, name, COALESCE(description, \'\') as description FROM projects WHERE id = ?',
    [projectId]
  )
  if (!project) throw new Error(`Project ${projectId} not found`)
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    nodes: listNodes(projectId),
    edges: listEdges(projectId),
  }
}

function commonDataModulesForProjects(projects: TransferProject[]): ModuleRow[] {
  const ids = new Set<string>()
  projects.forEach(project => {
    project.nodes.forEach(node => {
      const sharedId = readSharedDataModuleId(node.config)
      if (sharedId) ids.add(sharedId)
    })
  })
  if (ids.size === 0) return []
  return listAllModules().filter(mod => ids.has(mod.id))
}

export function exportWorkspaceData(workspaceId: string): TransferPayload {
  const workspace = queryOne<{ id: string; name: string; description: string }>(
    'SELECT id, name, COALESCE(description, \'\') as description FROM workspaces WHERE id = ?',
    [workspaceId]
  )
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)
  const projects = listProjects(workspaceId).map(project => exportProjectShape(project.id))
  return {
    format: 'a8a.export',
    version: 1,
    scope: 'workspace',
    exportedAt: new Date().toISOString(),
    modules: commonDataModulesForProjects(projects),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description ?? '',
      environments: listEnvironments(workspaceId),
      projects,
    },
  }
}

export function exportProjectData(projectId: string): TransferPayload {
  const project = exportProjectShape(projectId)
  return {
    format: 'a8a.export',
    version: 1,
    scope: 'project',
    exportedAt: new Date().toISOString(),
    modules: commonDataModulesForProjects([project]),
    project,
  }
}

function assertTransferPayload(payload: unknown, scope: TransferScope): TransferPayload {
  if (!isRecord(payload) || payload.format !== 'a8a.export' || payload.version !== 1 || payload.scope !== scope) {
    throw new Error(scope === 'workspace'
      ? '워크스페이스 내보내기 파일이 아닙니다.'
      : '프로젝트 내보내기 파일이 아닙니다.')
  }
  if (scope === 'workspace' && !isRecord(payload.workspace)) {
    throw new Error('워크스페이스 데이터가 없습니다.')
  }
  if (scope === 'project' && !isRecord(payload.project)) {
    throw new Error('프로젝트 데이터가 없습니다.')
  }
  return payload as TransferPayload
}

function importString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function importNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function importBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function requireImportString(value: unknown, fieldName: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} 값이 올바르지 않습니다.`)
  if (!allowEmpty && !value.trim()) throw new Error(`${fieldName} 값이 비어 있습니다.`)
  return value
}

function requireImportNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} 값이 올바르지 않습니다.`)
  }
  return value
}

function importOptionalString(value: unknown, fieldName: string): string {
  if (value == null) return ''
  if (typeof value !== 'string') throw new Error(`${fieldName} 값이 올바르지 않습니다.`)
  return value
}

function importOptionalSourcePort(value: unknown, fieldName: string): string | null {
  if (value == null) return null
  if (value === 'true' || value === 'false') return value
  throw new Error(`${fieldName} 값이 올바르지 않습니다.`)
}

function importEnvRows(value: unknown): EnvRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((env, index) => ({
    id: importString(env.id, `env-${index}`),
    name: importString(env.name, index === 0 ? 'BASE' : 'Environment'),
    isBase: importBoolean(env.isBase, index === 0),
    color: importString(env.color, '#4493f8'),
    initial: importString(env.initial, ''),
    vars: Array.isArray(env.vars)
      ? env.vars.filter(isRecord).map((v, varIndex) => ({
          id: importString(v.id, `var-${index}-${varIndex}`),
          key: importString(v.key, ''),
          value: importString(v.value, ''),
          enabled: importBoolean(v.enabled, true),
        })).filter(v => v.key.trim())
      : [],
  }))
}

function importNodeRows(value: unknown): NodeRow[] {
  if (!Array.isArray(value)) throw new Error('프로젝트 노드 목록이 올바르지 않습니다.')
  if (value.length === 0) throw new Error('프로젝트에는 노드가 필요합니다.')
  const usedNodeIds = new Set<string>()
  return value.map((node, index) => {
    if (!isRecord(node)) throw new Error(`프로젝트 노드 ${index + 1} 정보가 올바르지 않습니다.`)
    const id = requireImportString(node.id, `프로젝트 노드 ${index + 1} ID`)
    if (usedNodeIds.has(id)) throw new Error(`중복된 노드 ID가 있습니다: ${id}`)
    usedNodeIds.add(id)
    const type = requireImportString(node.type, `프로젝트 노드 ${index + 1} 타입`)
    if (!VALID_NODE_TYPES.has(type)) throw new Error(`지원하지 않는 모듈 타입입니다: ${type}`)
    return {
      id,
      projectId: importOptionalString(node.projectId, `프로젝트 노드 ${index + 1} 프로젝트 ID`),
      type,
      label: requireImportString(node.label, `프로젝트 노드 ${index + 1} 이름`),
      x: requireImportNumber(node.x, `프로젝트 노드 ${index + 1} X 좌표`),
      y: requireImportNumber(node.y, `프로젝트 노드 ${index + 1} Y 좌표`),
      width: requireImportNumber(node.width, `프로젝트 노드 ${index + 1} 가로 크기`),
      height: requireImportNumber(node.height, `프로젝트 노드 ${index + 1} 세로 크기`),
      config: requireImportString(node.config, `프로젝트 노드 ${index + 1} 설정`, true),
    }
  })
}

function importEdgeRows(value: unknown): EdgeRow[] {
  if (!Array.isArray(value)) throw new Error('프로젝트 연결선 목록이 올바르지 않습니다.')
  const usedEdgeIds = new Set<string>()
  return value.map((edge, index) => {
    if (!isRecord(edge)) throw new Error(`프로젝트 연결선 ${index + 1} 정보가 올바르지 않습니다.`)
    const id = requireImportString(edge.id, `프로젝트 연결선 ${index + 1} ID`)
    if (usedEdgeIds.has(id)) throw new Error(`중복된 연결선 ID가 있습니다: ${id}`)
    usedEdgeIds.add(id)
    return {
      id,
      projectId: importOptionalString(edge.projectId, `프로젝트 연결선 ${index + 1} 프로젝트 ID`),
      sourceNodeId: requireImportString(edge.sourceNodeId, `프로젝트 연결선 ${index + 1} 시작 노드 ID`),
      targetNodeId: requireImportString(edge.targetNodeId, `프로젝트 연결선 ${index + 1} 대상 노드 ID`),
      sourcePort: importOptionalSourcePort(edge.sourcePort, `프로젝트 연결선 ${index + 1} 시작 포트`),
    }
  })
}

function importProjectShape(value: unknown): TransferProject {
  if (!isRecord(value)) throw new Error('프로젝트 데이터가 올바르지 않습니다.')
  return {
    id: requireImportString(value.id, '프로젝트 ID'),
    name: requireImportString(value.name, '프로젝트 이름'),
    description: importOptionalString(value.description, '프로젝트 설명'),
    nodes: importNodeRows(value.nodes),
    edges: importEdgeRows(value.edges),
  }
}

function importModuleRows(value: unknown): ModuleRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((mod, index) => ({
    id: importString(mod.id, `module-${index}`),
    workspaceId: null,
    type: importString(mod.type, 'data'),
    label: importString(mod.label, 'DATA'),
    config: importString(mod.config, ''),
    isCommon: importBoolean(mod.isCommon, true),
  })).filter(mod => mod.id.trim() && mod.type === 'data' && mod.isCommon)
}

function insertImportedCommonModules(modules: ModuleRow[]): Map<string, string> {
  const moduleIdMap = new Map<string, string>()
  let sort = nextModuleSort(null, 'data', true)
  modules.forEach(mod => {
    if (moduleIdMap.has(mod.id)) return
    const id = randomUUID()
    moduleIdMap.set(mod.id, id)
    db.run(
      'INSERT INTO modules (id, workspace_id, type, label, config, is_common, sort) VALUES (?, NULL, ?, ?, ?, 1, ?)',
      [id, 'data', mod.label.trim() || 'DATA', mod.config ?? '', sort]
    )
    sort += 1
  })
  return moduleIdMap
}

function insertDefaultProjectNodes(projectId: string): void {
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'start', 'Start', 80, 160, defaultNodeWidth('start'), defaultNodeHeight('start'), ''])
  db.run('INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), projectId, 'end', 'End', 520, 160, defaultNodeWidth('end'), defaultNodeHeight('end'), ''])
}

function insertImportedProject(
  workspaceId: string,
  project: TransferProject,
  sort: number,
  moduleIdMap: Map<string, string>,
  usedProjectNames: Set<string>,
): ProjectRow {
  const projectId = randomUUID()
  const projectName = uniqueImportedName(project.name, usedProjectNames, '가져온 프로젝트')
  db.run(
    'INSERT INTO projects (id, workspace_id, name, description, sort) VALUES (?, ?, ?, ?, ?)',
    [projectId, workspaceId, projectName, project.description ?? '', sort]
  )

  const nodeIdMap = new Map<string, string>()
  const importedNodes: NodeRow[] = []
  let importedEdges: EdgeRow[] = []
  if (project.nodes.length === 0) {
    insertDefaultProjectNodes(projectId)
  } else {
    project.nodes.forEach(node => {
      const nodeId = randomUUID()
      nodeIdMap.set(node.id, nodeId)
      const sharedDataModuleId = readSharedDataModuleId(node.config ?? '')
      if (sharedDataModuleId && !moduleIdMap.has(sharedDataModuleId)) {
        throw new Error(`공용 DATA 모듈 참조를 찾을 수 없습니다: ${sharedDataModuleId}`)
      }
      const config = remapSharedDataModuleConfig(node.config ?? '', moduleIdMap)
      importedNodes.push({
        id: nodeId,
        projectId,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        width: node.width ?? defaultNodeWidth(node.type),
        height: node.height ?? defaultNodeHeight(node.type),
        config,
      })
    })

    importedEdges = validateProjectGraph(
      projectId,
      importedNodes,
      project.edges.flatMap(edge => {
        const sourceNodeId = nodeIdMap.get(edge.sourceNodeId)
        const targetNodeId = nodeIdMap.get(edge.targetNodeId)
        if (!sourceNodeId || !targetNodeId) {
          throw new Error(`연결선의 노드 참조를 찾을 수 없습니다: ${edge.sourceNodeId} -> ${edge.targetNodeId}`)
        }
        return [{
          id: randomUUID(),
          projectId,
          sourceNodeId,
          targetNodeId,
          sourcePort: edge.sourcePort ?? null,
        }]
      })
    )

    importedNodes.forEach(node => {
      db.run(
        'INSERT INTO nodes (id, project_id, type, label, x, y, width, height, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [node.id, projectId, node.type, node.label, node.x, node.y, node.width, node.height, node.config]
      )
    })
  }

  importedEdges.forEach(edge => {
    db.run(
      'INSERT INTO edges (id, project_id, source_node_id, target_node_id, source_port) VALUES (?, ?, ?, ?, ?)',
      [edge.id, projectId, edge.sourceNodeId, edge.targetNodeId, edge.sourcePort]
    )
  })

  return { id: projectId, name: projectName, description: project.description ?? '' }
}

export function importWorkspaceData(payload: unknown): TransferImportResult {
  const data = assertTransferPayload(payload, 'workspace')
  const workspace = data.workspace!
  const workspaceId = randomUUID()
  const existingWorkspaceNames = new Set(listWorkspaces().map(ws => ws.name))
  const workspaceName = uniqueImportedName(requireImportString(workspace.name, '워크스페이스 이름'), existingWorkspaceNames, '가져온 워크스페이스')
  const workspaceDescription = importOptionalString(workspace.description, '워크스페이스 설명')
  if (!Array.isArray(workspace.projects)) {
    throw new Error('워크스페이스 프로젝트 목록이 올바르지 않습니다.')
  }
  let firstProjectId: string | undefined
  let firstProjectName: string | undefined

  withTransaction(() => {
    db.run('INSERT INTO workspaces (id, name, description, sort) VALUES (?, ?, ?, ?)', [
      workspaceId,
      workspaceName,
      workspaceDescription,
      (queryOne<{ max_sort: number | null }>('SELECT MAX(sort) as max_sort FROM workspaces')?.max_sort ?? -1) + 1,
    ])

    const envs = importEnvRows(workspace.environments)
    if (envs.length === 0) {
      db.run('INSERT INTO environments (id, workspace_id, name, is_base, color, initial, sort) VALUES (?, ?, ?, 1, ?, ?, 0)', [randomUUID(), workspaceId, 'BASE', '#4493f8', ''])
    } else {
      envs.forEach((env, envIndex) => {
        const envId = randomUUID()
        db.run(
          'INSERT INTO environments (id, workspace_id, name, is_base, color, initial, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [envId, workspaceId, env.isBase ? 'BASE' : env.name, env.isBase ? 1 : 0, env.color, env.initial, envIndex]
        )
        env.vars.forEach((v, varIndex) => {
          db.run(
            'INSERT INTO env_vars (id, environment_id, key, value, enabled, sort) VALUES (?, ?, ?, ?, ?, ?)',
            [randomUUID(), envId, v.key, v.value, v.enabled ? 1 : 0, varIndex]
          )
        })
      })
    }

    const moduleIdMap = insertImportedCommonModules(importModuleRows(data.modules))
    const usedProjectNames = new Set<string>()
    const projects = workspace.projects.map(project => importProjectShape(project))
    projects.forEach((project, index) => {
      const inserted = insertImportedProject(workspaceId, project, index, moduleIdMap, usedProjectNames)
      if (!firstProjectId) {
        firstProjectId = inserted.id
        firstProjectName = inserted.name
      }
    })
  })
  save()

  return {
    scope: 'workspace',
    workspaceId,
    workspaceName,
    projectId: firstProjectId,
    projectName: firstProjectName,
  }
}

export function importProjectData(workspaceId: string, payload: unknown): TransferImportResult {
  ensureWorkspaceExists(workspaceId)
  const data = assertTransferPayload(payload, 'project')
  const project = importProjectShape(data.project)
  let importedProjectId: string | undefined
  let importedProjectName: string | undefined

  withTransaction(() => {
    const moduleIdMap = insertImportedCommonModules(importModuleRows(data.modules))
    const usedProjectNames = new Set(listProjects(workspaceId).map(p => p.name))
    const inserted = insertImportedProject(workspaceId, project, nextProjectSort(workspaceId), moduleIdMap, usedProjectNames)
    importedProjectId = inserted.id
    importedProjectName = inserted.name
  })
  save()

  return {
    scope: 'project',
    workspaceId,
    projectId: importedProjectId,
    projectName: importedProjectName,
  }
}
