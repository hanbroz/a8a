# Technical Debt

Known issues and deferred improvements. All items documented here have been triaged and do not require immediate action, but should be addressed before production release.

---

## CRITICAL

These require architectural changes and pose security/data integrity risks.

### 1. IPC Handler Input Validation

**File**: `src/main/ipc.ts`  
**Issue**: All IPC handlers accept untrusted renderer payloads without validation. A renderer bug or XSS attack could corrupt the database.

**Risk**: 
- `env:upsert` accepts arbitrary `EnvRow` with no shape validation
- `proj:create`, `proj:update` accept strings without length/content checks
- No type validation at the IPC boundary

**Fix**:
Add [zod](https://zod.dev) or similar schema validation at each IPC handler entry point before passing to `db.ts`:

```typescript
import { z } from 'zod'

const EnvRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  isBase: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  initial: z.string().max(1),
  vars: z.array(z.object({
    id: z.string().uuid(),
    key: z.string().min(1).max(255),
    value: z.string(),
    enabled: z.boolean()
  }))
})

ipcMain.handle('env:upsert', (_, workspaceId: string, env: unknown) => {
  const validated = EnvRowSchema.parse(env)
  return db.upsertEnvironment(workspaceId, validated)
})
```

**Priority**: Address before any multi-workspace data sharing features.

---

### 2. contextIsolation Fallback Exposes API

**File**: `src/preload/index.ts:37-42`  
**Issue**: If `contextIsolation: false` is set in BrowserWindow, the `else` branch exposes `window.api` and `window.electron` to untrusted renderer scripts.

**Current Code**:
```typescript
if (process.contextIsolation) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api  // Exposes to XSS
}
```

**Fix**:
1. Verify `contextIsolation: true` is set in `src/main/index.ts:16-19`
2. Remove the `else` branch entirely
3. Add a runtime assertion:

```typescript
if (!process.contextIsolation) {
  throw new Error('contextIsolation must be enabled in BrowserWindow config')
}
contextBridge.exposeInMainWorld('api', api)
```

---

## HIGH

These pose data loss or consistency risks and should be addressed soon.

### 3. In-Place File Writes Risk Corruption

**File**: `src/main/db.ts:38-40`  
**Issue**: `save()` overwrites the database file in-place. If the process crashes or power fails mid-write, the file will be corrupted and unrecoverable.

**Current Code**:
```typescript
function save(): void {
  writeFileSync(dbPath(), Buffer.from(db.export()))
}
```

**Fix**: Use atomic write pattern (write to temp file, then rename):

```typescript
function save(): void {
  const path = dbPath()
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, Buffer.from(db.export()))
  renameSync(tmpPath, path)  // Atomic on most filesystems
}
```

---

### 4. Missing Foreign Key Constraints

**File**: `src/main/db.ts:53-88` (schema creation)  
**Issue**: No database-level foreign keys or cascade delete rules. Manual cascade in `deleteWorkspace` is fragile and can leak data if logic changes.

**Current Code** (manual cascade):
```typescript
export function deleteWorkspace(id: string): void {
  const envIds = queryAll<{ id: string }>('SELECT id FROM environments WHERE workspace_id = ?', [id])
  envIds.forEach(e => db.run('DELETE FROM env_vars WHERE environment_id = ?', [e.id]))
  db.run('DELETE FROM environments WHERE workspace_id = ?', [id])
  db.run('DELETE FROM projects WHERE workspace_id = ?', [id])
  db.run('DELETE FROM workspaces WHERE id = ?', [id])
}
```

**Fix**: Add FOREIGN KEY constraints to schema with ON DELETE CASCADE:

```sql
CREATE TABLE IF NOT EXISTS environments (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  is_base      INTEGER DEFAULT 0,
  color        TEXT DEFAULT '#4493f8',
  sort         INTEGER DEFAULT 0,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS env_vars (
  id             TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  key            TEXT NOT NULL,
  value          TEXT DEFAULT '',
  enabled        INTEGER DEFAULT 1,
  sort           INTEGER DEFAULT 0,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  sort         INTEGER DEFAULT 0,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```

Then simplify `deleteWorkspace`:
```typescript
export function deleteWorkspace(id: string): void {
  db.run('DELETE FROM workspaces WHERE id = ?', [id])
  save()
}
```

---

### 5. Missing UNIQUE Constraints

**File**: `src/main/db.ts:53-88` (schema creation)  
**Issue**: No uniqueness constraints. Can create duplicate environments or projects with the same name in a workspace, or multiple BASE environments per workspace.

**Fix**: Add constraints to schema:

```sql
CREATE TABLE IF NOT EXISTS environments (
  ...
  UNIQUE(workspace_id, name)
);

-- Partial unique index for BASE env (one per workspace)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_base 
  ON environments(workspace_id) WHERE is_base = 1;

CREATE TABLE IF NOT EXISTS projects (
  ...
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS env_vars (
  ...
  UNIQUE(environment_id, key)
);
```

---

### 6. Missing workspace_id Ownership Validation in upsertEnvironment

**File**: `src/main/db.ts:164-182`  
**Function**: `upsertEnvironment()`  
**Issue**: UPDATE path does not validate that the environment belongs to the specified workspace. A compromised IPC call could mutate data across workspaces.

**Current Code**:
```typescript
export function upsertEnvironment(workspaceId: string, env: EnvRow): void {
  const exists = queryOne('SELECT id FROM environments WHERE id = ?', [env.id])
  if (exists) {
    // No check that env.id belongs to workspaceId
    db.run('UPDATE environments SET name = ?, color = ?, initial = ? WHERE id = ?', ...)
  }
  // ...
}
```

**Fix**: Add ownership check:

```typescript
export function upsertEnvironment(workspaceId: string, env: EnvRow): void {
  const exists = queryOne<{ workspace_id: string }>(
    'SELECT workspace_id FROM environments WHERE id = ?',
    [env.id]
  )
  if (exists && exists.workspace_id !== workspaceId) {
    throw new Error('Cross-workspace data mutation attempted')
  }
  // ... rest of logic
}
```

---

### 7. Stale Closure in saveEnv/saveProject

**File**: `src/renderer/src/App.tsx:190-207`, `229-247`  
**Functions**: `saveEnv()`, `saveProject()`  
**Issue**: Both functions use `modalWsId` and `modalProject.wsId`, which are captured by closure at the time the modal opens. If the user opens a different workspace modal before the async save completes, the save will write to the wrong workspace. Additionally, no try/catch around the await means UI state diverges from DB on error.

**Current Code**:
```typescript
const saveEnv = async (env: Environment): Promise<void> => {
  await window.api.environment.upsert(modalWsId, { ... })  // Stale closure
  setWorkspaces(prev => prev.map(w => {
    if (w.id !== modalWsId) return w  // May not match actual state
    // ...
  }))
  // No error handling
  closeEnvModal()
}
```

**Fix**: Pass workspace ID explicitly from modal state, add error handling:

```typescript
const saveEnv = async (env: Environment): Promise<void> => {
  if (!modalWsId) return
  try {
    await window.api.environment.upsert(modalWsId, { ... })
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== modalWsId) return w
      // ...
    }))
  } catch (err) {
    console.error('Failed to save environment:', err)
    // Show error toast/dialog to user
    return
  }
  closeEnvModal()
}
```

**Related**: Consider refactoring modal state to explicit `{ mode: 'add'|'edit'; env; wsId } | null` instead of `{ env, wsId, ...}` tri-state.

---

## MEDIUM

These affect code maintainability and correctness but do not cause data loss.

### 8. Fragile modalEnv Tri-State

**File**: `src/renderer/src/App.tsx:53`  
**Issue**: `modalEnv` uses `null | undefined | Environment` to distinguish "closed" (undefined) vs "add mode" (null) vs "edit mode" (Environment). This is error-prone and unclear.

**Current Code**:
```typescript
const [modalEnv, setModalEnv] = useState<Environment | null | undefined>(undefined)
const openAddEnvModal = (wsId: string): void => { setModalWsId(wsId); setModalEnv(null) }
const closeEnvModal = (): void => setModalEnv(undefined)
```

**Fix**: Use explicit discriminated union:

```typescript
type EnvModalState = { mode: 'add' | 'edit'; env: Environment | null; wsId: string } | null

const [envModal, setEnvModal] = useState<EnvModalState>(null)
const openAddEnvModal = (wsId: string): void => setEnvModal({ mode: 'add', env: null, wsId })
const openEditEnvModal = (wsId: string, env: Environment): void => setEnvModal({ mode: 'edit', env, wsId })
const closeEnvModal = (): void => setEnvModal(null)
```

---

### 9. EnvModal Does Not Deduplicate Variable Keys on Save

**File**: `src/renderer/src/components/env/EnvModal.tsx` (review required)  
**Issue**: If a user manually adds two env vars with the same key name, both are saved. Database `UNIQUE(environment_id, key)` constraint (item #5) will eventually reject this, but the UI should prevent it.

**Fix**: Before saving, deduplicate vars by key (last one wins or show validation error).

---

### 10. initial Field Uses charAt(0) — Breaks on Multi-Codepoint Characters

**File**: `src/renderer/src/App.tsx:318` and component files  
**Issue**: `proj.name.charAt(0)` breaks on emoji, Korean characters, and other multi-codepoint Unicode. Should use `Array.from()` or `[...string]`.

**Current Code**:
```typescript
{proj.name.charAt(0).toUpperCase()}  // Fails on Korean: "한".charAt(0) → undefined behavior
```

**Fix**:
```typescript
{[...proj.name][0]?.toUpperCase()}  // Works: [...'한국'][0] → '한'
```

---

### 11. init() Uses Untyped Cast for listEnvironments

**File**: `src/renderer/src/App.tsx:73`, `159`  
**Issue**: `envs.find(e => e.isBase)` and subsequent `as Environment[]` cast silence TypeScript. Works only because the API returns the correct shape.

**Current Code**:
```typescript
const baseEnv = envs.find(e => e.isBase)
return {
  // ...
  environments: envs as Environment[],  // Unsafe cast
  activeEnvId: baseEnv?.id ?? envs[0]?.id ?? '',
}
```

**Fix**: Type guard or explicit return from API:

```typescript
// Option 1: Type guard in component
const typedEnvs = envs as Environment[]
const baseEnv = typedEnvs.find(e => e.isBase)

// Option 2: Type the IPC return in preload/index.ts
environment: {
  list: (workspaceId: string): Promise<Environment[]> => ipcRenderer.invoke('env:list', workspaceId),
}
```

---

## LOW

Minor code quality and deprecation issues.

### 12. @ts-ignore Should Be @ts-expect-error

**File**: `src/preload/index.ts:38-41`  
**Issue**: `@ts-ignore` ignores all TypeScript errors silently. Use `@ts-expect-error` instead to fail if the error is fixed.

**Current Code**:
```typescript
} else {
  // @ts-ignore
  window.electron = electronAPI
}
```

**Fix**:
```typescript
} else {
  // @ts-expect-error — contextIsolation should always be true; this else is a fallback
  window.electron = electronAPI
}
```

---

### 13. JSX.Element Return Types Deprecation (React 19)

**File**: `src/renderer/src/App.tsx:29` and other components  
**Issue**: React 19 deprecates `JSX.Element`. Use `React.ReactNode` or no return type annotation.

**Current Code**:
```typescript
export default function App(): JSX.Element {
```

**Fix**:
```typescript
export default function App(): React.ReactNode {
  // or omit return type entirely; inference is sufficient
}
```

---

### 14. console.error in Preload Swallows Errors Silently

**File**: `src/preload/index.ts:35`  
**Issue**: `console.error` in preload context does not surface errors in production. Errors during contextBridge.exposeInMainWorld are silently logged.

**Current Code**:
```typescript
} catch (error) {
  console.error(error)  // Silent in production
}
```

**Fix**: Log to main process or throw in development:

```typescript
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error)
  if (process.env.NODE_ENV === 'development') {
    throw error
  }
  // In production, log to main process for debugging
  ipcRenderer.send('preload:error', msg)
}
```

---

## Summary Table

| Item | Severity | Category | File |
|------|----------|----------|------|
| 1 | CRITICAL | Security | `src/main/ipc.ts` |
| 2 | CRITICAL | Security | `src/preload/index.ts` |
| 3 | HIGH | Data Integrity | `src/main/db.ts` |
| 4 | HIGH | Data Integrity | `src/main/db.ts` |
| 5 | HIGH | Data Integrity | `src/main/db.ts` |
| 6 | HIGH | Data Integrity | `src/main/db.ts` |
| 7 | HIGH | Logic Error | `src/renderer/src/App.tsx` |
| 8 | MEDIUM | Maintainability | `src/renderer/src/App.tsx` |
| 9 | MEDIUM | UX | `src/renderer/src/components/env/EnvModal.tsx` |
| 10 | MEDIUM | Correctness | `src/renderer/src/App.tsx` |
| 11 | MEDIUM | Type Safety | `src/renderer/src/App.tsx` |
| 12 | LOW | Code Quality | `src/preload/index.ts` |
| 13 | LOW | Deprecation | `src/renderer/src/App.tsx` |
| 14 | LOW | Observability | `src/preload/index.ts` |
