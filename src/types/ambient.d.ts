declare module '*.css'

declare module '*?worker' {
  const WorkerFactory: { new (): Worker }
  export default WorkerFactory
}

declare module 'sql.js' {
  export type SqlValue = string | number | Uint8Array | null

  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }

  export interface Statement {
    bind(values?: SqlValue[]): boolean
    step(): boolean
    getAsObject(): Record<string, SqlValue>
    free(): void
  }

  export interface Database {
    prepare(sql: string): Statement
    run(sql: string, params?: SqlValue[]): void
    exec(sql: string): QueryExecResult[]
    export(): Uint8Array
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database
  }

  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>
}
