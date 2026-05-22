# a8a Workflow Editor

An Electron-based visual workflow editor built with React, TypeScript, and sql.js. Design and manage automated workflows with an intuitive canvas-based interface.

## Features

### Start/End Nodes
Every new project automatically creates Start and End nodes on the workflow canvas. These serve as entry and exit points for your workflow and are persisted to the database on project creation.

### Workflow Canvas
Drag and drop nodes to design your workflow visually. Connect nodes by dragging from an output port to create bezier curve edges. The canvas includes intelligent snap detection (20px radius) for precise alignment. Hover over any connection line to reveal a delete button (X) at the midpoint for easy edge removal.

### Node Configuration
Double-click the Start node to open a settings modal and configure workflow triggers:
- **Manual Mode** (수동): Trigger workflows on demand
- **Schedule Mode** (스케줄): Set recurring schedules with Daily, Weekly, Monthly, or custom Cron expressions. Includes time picker, weekday toggles, and live cron preview.

Configuration is automatically saved to the database as JSON.

### Workflow Connections
Duplicate edges are silently ignored—the system prevents connecting the same source→target twice. Edge deletion is instant with visual confirmation via a delete button that appears on hover.

### UI Refinements
All select elements feature a custom dropdown arrow design with proper spacing (padding-right: 32px minimum) to prevent the arrow from overlapping the text.

## Tech Stack

- **Frontend**: React + TypeScript
- **Desktop**: Electron
- **Database**: sql.js (in-memory SQLite with persistence)
- **Styling**: CSS with custom component styling

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Project Structure

- `src/main/` — Electron main process, IPC handlers, and database logic
- `src/preload/` — Preload scripts for IPC bridge
- `src/renderer/src/` — React app components and styles
- `src/renderer/src/components/canvas/` — WorkflowCanvas component and node definitions
