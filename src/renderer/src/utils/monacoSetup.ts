// Configure Monaco to use the locally bundled copy instead of the default CDN
// loader. Required for Electron, where renderers run without network access
// and we want a deterministic build.

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

// `self.MonacoEnvironment` must be set before any Monaco code spawns a worker.
;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

loader.config({ monaco })
