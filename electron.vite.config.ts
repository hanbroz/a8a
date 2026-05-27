import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['sql.js']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string): string | undefined {
            if (id.includes('node_modules/monaco-editor')) return 'monaco'
            if (id.includes('node_modules/@monaco-editor')) return 'monaco'
            if (id.includes('node_modules/sql.js')) return 'sqljs'
            if (id.includes('node_modules/exceljs')) return 'exceljs'
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
            return undefined
          }
        }
      }
    }
  }
})
