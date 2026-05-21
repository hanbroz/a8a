# Architecture Overview

## Stack

- **Electron** 42.2.0 — Desktop application framework
- **electron-vite** 5 — Build tooling for Electron + Vite
- **React** 19.2.6 — UI framework
- **TypeScript** 6.0.3 — Type safety
- **sql.js** 1.14.1 — WebAssembly SQLite, in-memory DB with file persistence
- **No state library** — All state lives in App.tsx
- **No React Router** — Single-page application with local state management

---

## Process Model

Electron uses a multi-process architecture:

```
┌─────────────────────────────────────────┐
│           Main Process (Node.js)        │
│ • Database (sql.js)                     │
│ • IPC handler registration              │
│ • File I/O                              │
│ • Window management                     │
└──────────────────┬──────────────────────┘
                   │
            IPC Bridge (contextBridge)
                   │
     ┌─────────────┴─────────────┐
     │                           │
     ↓                           ↓
┌──────────────┐      ┌──────────────────┐
│ Preload      │      │ Renderer Process │
│ (Node.js +   │      │ (Browser Context)│
│ contextAPI)  │      │                  │
│              │      │ • React UI       │
│ Exposes:     │      │ • User events    │
│ window.api   │      │ • DOM rendering  │
│ window.      │      │                  │
│   electron   │      │ Calls IPC via:   │
└──────────────┘      │ window.api.*     │
                      └──────────────────┘
```

**Data Flow**:
1. **Renderer** (React) → calls `window.api.workspace.list()`
2. **IPC** sends message to main process
3. **Main Process** handles in `src/main/ipc.ts`, calls `src/main/db.ts`
4. **Database** queries sql.js in-memory store
5. **Response** sent back to renderer
6. **Renderer** updates state and re-renders

**Security Note**: `contextIsolation: true` prevents untrusted scripts in the renderer from accessing `window.api`. The preload script (running in both contexts) bridges the gap securely.

---

## Data Layer

**File**: `src/main/db.ts`

### Database Storage

- **In-Memory**: sql.js WebAssembly SQLite database loaded on startup
- **Persistence**: File at `{userData}/a8a.db` (auto-created on first save)
- **Format**: Binary SQLite 3
- **Foreign Keys**: `PRAGMA foreign_keys = ON` enabled on init

### Schema

All IDs are **UUID v4** (text columns).

```sql
workspaces
├─ id (TEXT PRIMARY KEY)
├─ name (TEXT NOT NULL)
├─ description (TEXT DEFAULT '')
└─ sort (INTEGER DEFAULT 0)

environments
├─ id (TEXT PRIMARY KEY)
├─ workspace_id (TEXT NOT NULL) — FK to workspaces
├─ name (TEXT NOT NULL)
├─ is_base (INTEGER DEFAULT 0) — 1 for BASE env, 0 otherwise
├─ color (TEXT DEFAULT '#4493f8') — Hex color for env badge
├─ initial (TEXT DEFAULT '') — First character of name for display
└─ sort (INTEGER DEFAULT 0)

env_vars
├─ id (TEXT PRIMARY KEY)
├─ environment_id (TEXT NOT NULL) — FK to environments
├─ key (TEXT NOT NULL)
├─ value (TEXT DEFAULT '')
├─ enabled (INTEGER DEFAULT 1) — 1 = enabled, 0 = disabled
└─ sort (INTEGER DEFAULT 0)

projects
├─ id (TEXT PRIMARY KEY)
├─ workspace_id (TEXT NOT NULL) — FK to workspaces
├─ name (TEXT NOT NULL)
├─ description (TEXT DEFAULT '')
└─ sort (INTEGER DEFAULT 0)

modules
├─ id (TEXT PRIMARY KEY)
├─ name (TEXT NOT NULL)
└─ sort (INTEGER DEFAULT 0)
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `initDb()` | Load/create DB, run migrations, seed if empty |
| `listWorkspaces()` | Get all workspaces (sorted by sort, then rowid) |
| `createWorkspace(name, desc)` | Create workspace + auto-create BASE env |
| `deleteWorkspace(id)` | Cascade-delete workspace, envs, projects, vars |
| `listEnvironments(wsId)` | Get all envs + their vars for workspace |
| `upsertEnvironment(wsId, env)` | Insert or update env and all its vars |
| `deleteEnvironment(id)` | Delete non-BASE env and its vars |
| `listProjects(wsId)` | Get all projects for workspace |
| `createProject(wsId, name, desc)` | Create project |
| `deleteProject(id)` | Delete project |
| `listModules()` | Get all modules (global, not workspace-scoped) |
| `createModule(name)` | Create module |
| `deleteModule(id)` | Delete module |

### Initialization

`initDb()` runs on app startup:
1. Initialize sql.js WASM module (finds wasm file in node_modules)
2. Load existing `a8a.db` if it exists, otherwise create empty DB
3. Create schema (idempotent, uses `IF NOT EXISTS`)
4. Call `seedIfEmpty()` to create default workspace + BASE env if DB is empty
5. Save to disk

---

## IPC API

**Main File**: `src/main/ipc.ts`  
**Preload Bridge**: `src/preload/index.ts`

All IPC calls are **asynchronous** and return Promises. The renderer calls them via `window.api.*`.

### Workspace API

```typescript
window.api.workspace.list()
  → Promise<{id, name, description}[]>

window.api.workspace.create(name: string, description: string)
  → Promise<{id, name, description}>

window.api.workspace.update(id: string, name: string, description: string)
  → Promise<void>

window.api.workspace.delete(id: string)
  → Promise<void>
```

### Environment API

```typescript
window.api.environment.list(workspaceId: string)
  → Promise<{id, name, isBase, color, initial, vars: {id, key, value, enabled}[]}[]>

window.api.environment.upsert(workspaceId: string, env: Environment)
  → Promise<void>

window.api.environment.delete(id: string)
  → Promise<void>
```

### Project API

```typescript
window.api.project.list(workspaceId: string)
  → Promise<{id, name, description}[]>

window.api.project.create(workspaceId: string, name: string, description: string)
  → Promise<{id, name, description}>

window.api.project.update(id: string, name: string, description: string)
  → Promise<void>

window.api.project.delete(id: string)
  → Promise<void>
```

### Module API

```typescript
window.api.module.list()
  → Promise<{id, name}[]>

window.api.module.create(name: string)
  → Promise<{id, name}>

window.api.module.rename(id: string, name: string)
  → Promise<void>

window.api.module.delete(id: string)
  → Promise<void>
```

---

## State Management

**File**: `src/renderer/src/App.tsx`

All application state lives in the root `<App>` component. No external state library (Redux, Zustand, etc.).

### State Shape

```typescript
type Workspace = {
  id: string
  name: string
  description: string
  environments: Environment[]      // Loaded from DB on workspace select
  activeEnvId: string              // Currently selected env in this workspace
  projects: ProjectItem[]          // Loaded from DB on workspace select
  activeProjectId: string          // Currently selected project in this workspace
}

type Environment = {
  id: string
  name: string
  isBase: boolean                  // true for the auto-created BASE env
  color: string                    // Hex color, e.g. '#4493f8'
  initial: string                  // First char of name for badge display
  vars: EnvVarRow[]                // Environment variables
}

type EnvVarRow = {
  id: string
  key: string
  value: string
  enabled: boolean
}

type ProjectItem = {
  id: string
  name: string
  description: string
}
```

### Root State Variables

| State | Type | Purpose |
|-------|------|---------|
| `workspaces` | `Workspace[]` | All workspaces with their envs and projects |
| `activeWsId` | `string` | Currently selected workspace ID |
| `theme` | `'dark' \| 'light'` | UI theme (persisted in state, not localStorage yet) |
| `sidebarLayout` | `'full' \| 'icons'` | Sidebar expanded or icon-only mode |
| `sidebarWidth` | `number` | Sidebar width in pixels (180–480, persisted in localStorage) |
| `logState` | `'collapsed' \| 'fullscreen'` | Log panel state |
| `loading` | `boolean` | Initial DB load in progress |
| `modalEnv` | `Environment \| null \| undefined` | Env add/edit modal state (see TECH_DEBT #8) |
| `modalWsId` | `string` | Workspace ID for env modal (closure issue in TECH_DEBT #7) |
| `modalProject` | `{wsId, project} \| null` | Project add/edit modal state |
| `modalWorkspace` | `{workspace} \| null` | Workspace add/edit modal state |
| `confirmDeleteWsId` | `string \| null` | Workspace delete confirmation |
| `confirmDeleteProject` | `{wsId, project} \| null` | Project delete confirmation |
| `confirmDeleteEnv` | `{wsId, env} \| null` | Environment delete confirmation |

### Load on Mount

When the app loads (`useEffect` with empty deps):
1. Call `window.api.workspace.list()`
2. For each workspace, call `window.api.environment.list(wsId)` and `window.api.project.list(wsId)` in parallel
3. Find the BASE env in each workspace (or use first env as fallback)
4. Set `workspaces` state and `activeWsId` to first workspace

### Save Patterns

All saves follow this pattern:
```typescript
const handleSave = async (data) => {
  await window.api.method(data)           // Write to DB
  setWorkspaces(prev => ...)              // Update local state
  closeModal()                            // Close modal
}
```

No explicit refetch from DB — state is updated optimistically. **Risk**: If IPC call fails, state diverges from DB (TECH_DEBT #7).

---

## UI Structure

### Layout

```
┌─────────────────────────────────────────────┐
│ Sidebar (244px default, 180–480px range)    │ Workspace Area
├─────────────────────────────────────────────┤
│ Header (brand + collapse btn)                │ ┌─────────────────────┐
│ ─────────────────────────────────────────── │ │ Topbar              │
│ EnvSection                                  │ │ ┌────────────────────┤
│ • Active env dropdown                       │ │ │ Env Selector │ ... │
│ • Add env button                            │ │ └────────────────────┘
│ • List of envs (sortable)                   │ │                     │
│                                             │ │ Canvas Area         │
│ ProjectSection                              │ │ (placeholder)       │
│ • Active project list                       │ │                     │
│ • Add project button                        │ │                     │
│ • List of projects (sortable)               │ │                     │
│                                             │ │                     │
│ ModuleSection                               │ ├─────────────────────┤
│ • List of modules (global)                  │ │ Log Panel           │
│ • Add module button                         │ │ (collapsed/expand)  │
│                                             │ └─────────────────────┘
└─────────────────────────────────────────────┘
  │ Resize handle (180–480px)
```

### Sidebar Modes

**Full Mode** (`sidebarLayout === 'full'`):
- Width: 180–480px (user-resizable, persisted in localStorage)
- Shows full workspace/env/project names
- Expandable sections

**Icon Mode** (`sidebarLayout === 'icons'`):
- Width: 52px (fixed)
- Shows only project first letter in colored badge
- Hover tooltip with full path: `WorkspaceName › ProjectName`

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `App` | `src/renderer/src/App.tsx` | Root component, state container, layout |
| `WorkspaceHeader` | `src/renderer/src/components/sidebar/WorkspaceHeader.tsx` | Workspace selector + CRUD |
| `EnvSection` | `src/renderer/src/components/env/EnvSection.tsx` | Environment list + selector |
| `EnvModal` | `src/renderer/src/components/env/EnvModal.tsx` | Add/edit environment modal |
| `ProjectSection` | `src/renderer/src/components/sidebar/ProjectSection.tsx` | Project list + selector |
| `ProjectModal` | `src/renderer/src/components/sidebar/ProjectModal.tsx` | Add/edit project modal |
| `WorkspaceModal` | `src/renderer/src/components/sidebar/WorkspaceModal.tsx` | Add/edit workspace modal |
| `ModuleSection` | `src/renderer/src/components/sidebar/ModuleSection.tsx` | Module list + CRUD |
| `ConfirmDialog` | `src/renderer/src/components/ConfirmDialog.tsx` | Generic delete confirmation modal |

---

## Key Design Decisions

### 1. BASE Environment Per Workspace

Every workspace has an auto-created, non-deletable `BASE` environment. This serves as a default environment for new projects and API calls. Users cannot delete it or change its name.

**Why**: Simplifies the data model — every workspace always has at least one environment. No null-check needed for "active environment."

### 2. Environment Color + Initial Badge

Each environment has a `color` (hex) and `initial` (first character of name for compact display in icon mode). The initial is displayed in a colored circle badge in the sidebar.

**Why**: Visual distinction of environments in the icon-only sidebar mode.

### 3. No React Router

The app is a single-page app with no route navigation. Modal state and sidebar selection drive the UI. A future canvas/workflow editor will be added, but it will be a single large component in the workspace area.

**Why**: Simpler state management. The entire app state is in App.tsx and passed down to components.

### 4. Sidebar Resizable but Not Dockable

The sidebar is resizable horizontally (180–480px range) and can collapse to icon-only mode, but it's always on the left and cannot be moved or undocked.

**Why**: Predictable layout, simpler implementation.

### 5. All State in App.tsx, Not Redux/Zustand

No external state management library. All state lives in the root component and is passed via props. This simplifies the codebase for a small team.

**Risk**: Component tree is deep if new features are added without refactoring. At that point, consider migrating to Zustand or Jotai for fine-grained updates.

### 6. Optimistic Updates

When the user saves a workspace/env/project, the local state is updated immediately and the modal closes. If the IPC call fails, the UI and DB diverge silently (TECH_DEBT #7).

**Why**: Better perceived performance and simpler code. The trade-off is acceptable for now; a future enhancement would add error handling and rollback.

---

## File Structure

### Main Process

```
src/main/
├─ index.ts           (Electron app initialization, window creation)
├─ ipc.ts             (IPC handler registration for all APIs)
└─ db.ts              (Database schema, queries, persistence)
```

### Preload

```
src/preload/
└─ index.ts           (contextBridge, exposes window.api and window.electron)
```

### Renderer (React)

```
src/renderer/src/
├─ main.tsx           (Entry point, React.render)
├─ App.tsx            (Root component, layout, state)
├─ globals.d.ts       (TypeScript declarations for window.api)
│
├─ components/
│  ├─ Icon.tsx        (Icon components)
│  ├─ ConfirmDialog.tsx
│  ├─ sidebar/
│  │  ├─ WorkspaceHeader.tsx
│  │  ├─ WorkspaceModal.tsx
│  │  ├─ EnvSection.tsx
│  │  ├─ ProjectSection.tsx
│  │  ├─ ProjectModal.tsx
│  │  └─ ModuleSection.tsx
│  └─ env/
│     ├─ EnvSection.tsx
│     └─ EnvModal.tsx
│
├─ hooks/
│  └─ useSidebarOpen.ts
│
├─ styles/
│  └─ (CSS files)
│
└─ assets/
   └─ (Images, icons, etc.)
```

### Build Artifacts

```
out/
├─ main/              (Compiled main process)
├─ preload/           (Compiled preload script)
└─ renderer/          (Compiled React bundle)
```

---

## Startup Sequence

1. **Electron Main Process** (`src/main/index.ts`)
   - `app.whenReady()` listener fires
   - `initDb()` called (load/create DB)
   - `registerIpcHandlers()` called (register all IPC routes)
   - `createWindow()` called (create BrowserWindow with preload)

2. **Preload Script** (`src/preload/index.ts`)
   - Runs before renderer loads
   - Exposes `window.api` and `window.electron` via contextBridge

3. **React Renderer** (`src/renderer/src/App.tsx`)
   - React mounts App component
   - `useEffect` on mount calls `window.api.workspace.list()`
   - Loads all workspaces, envs, projects into state
   - Renders UI

---

## Build & Development

### Development

```bash
npm run dev
```

Runs electron-vite in dev mode. Hot reload for both main and renderer processes.

### Production Build

```bash
npm run build
```

Builds and bundles the app.

### Package for Distribution

```bash
npm run build:mac   # macOS .dmg
npm run build:win   # Windows .exe
npm run build:linux # Linux AppImage
```

Uses electron-builder with native code signing support (if configured).

---

## Security Considerations

1. **contextIsolation: true** — Preload script runs in a separate context, preventing renderer XSS from accessing Node.js APIs
2. **sandbox: false** — Currently disabled to allow sql.js WASM to work (known limitation)
3. **No eval()** — Code is bundled, no dynamic evaluation
4. **IPC handlers are untrusted** — Renderer input should be validated (TECH_DEBT #1)

**Next Steps**: Enable sandbox when sql.js supports it, add input validation to IPC handlers.
