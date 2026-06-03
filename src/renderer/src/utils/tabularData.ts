import ExcelJS from 'exceljs'

type TableDataLanguage = 'ko' | 'en'

export interface ParsedTableData {
  fileName: string
  columns: string[]
  rows: Record<string, unknown>[]
}

export type ParseTableFileResult =
  | { ok: true; data: ParsedTableData }
  | { ok: false; error: string }

function workbookBufferToBase64(buffer: unknown): string {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer as ArrayBufferLike)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function normalizeWorkbookCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeHeader(raw: unknown, index: number): string {
  const key = String(raw ?? '').trim()
  return key || `column_${index + 1}`
}

function dedupeColumns(columns: string[]): string[] {
  const counts = new Map<string, number>()
  return columns.map((column, index) => {
    const base = normalizeHeader(column, index)
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

function tableMessage(language: TableDataLanguage, key: 'emptyRows' | 'noColumns' | 'csvRows' | 'jsonParse' | 'jsonArray' | 'jsonObjects' | 'excelSheet' | 'excelHeader' | 'excelParse' | 'fileRead' | 'unsupported'): string {
  const ko = language === 'ko'
  switch (key) {
    case 'emptyRows': return ko ? '반복 데이터가 없습니다.' : 'No repeat data rows were found.'
    case 'noColumns': return ko ? '테이블 형식의 컬럼을 찾을 수 없습니다.' : 'No table columns were found.'
    case 'csvRows': return ko ? 'CSV는 헤더와 최소 1개 이상의 데이터 행이 필요합니다.' : 'CSV requires a header and at least one data row.'
    case 'jsonParse': return ko ? 'JSON 파일을 해석할 수 없습니다.' : 'The JSON file could not be parsed.'
    case 'jsonArray': return ko ? 'JSON 반복 데이터는 객체 배열이어야 합니다.' : 'JSON repeat data must be an array of objects.'
    case 'jsonObjects': return ko ? 'JSON 배열의 모든 항목은 객체여야 합니다.' : 'Every item in the JSON array must be an object.'
    case 'excelSheet': return ko ? 'Excel 시트를 찾을 수 없습니다.' : 'No Excel sheet was found.'
    case 'excelHeader': return ko ? 'Excel 첫 행에 헤더가 필요합니다.' : 'The first Excel row must contain headers.'
    case 'excelParse': return ko ? 'Excel 파일을 해석할 수 없습니다.' : 'The Excel file could not be parsed.'
    case 'fileRead': return ko ? '파일을 읽을 수 없습니다.' : 'The file could not be read.'
    case 'unsupported': return ko ? 'Excel(.xlsx), CSV, JSON 파일만 첨부할 수 있습니다.' : 'Only Excel(.xlsx), CSV, and JSON files can be attached.'
  }
}

function withNoColumn(rows: Record<string, unknown>[]): ParsedTableData['rows'] {
  return rows.map((row, index) => {
    const { no: _reservedNo, ...rest } = row
    return { no: index + 1, ...rest }
  })
}

function finalize(fileName: string, columns: string[], rows: Record<string, unknown>[], language: TableDataLanguage): ParseTableFileResult {
  if (rows.length === 0) return { ok: false, error: tableMessage(language, 'emptyRows') }
  const normalizedColumns = dedupeColumns(columns).filter(column => column !== 'no')
  const dataColumns = normalizedColumns.length > 0
    ? normalizedColumns
    : Array.from(new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 'no'))))
  if (dataColumns.length === 0) return { ok: false, error: tableMessage(language, 'noColumns') }
  return {
    ok: true,
    data: {
      fileName,
      columns: ['no', ...dataColumns],
      rows: withNoColumn(rows),
    },
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        value += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      row.push(value)
      value = ''
      continue
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(value)
      if (row.some(cell => cell.trim().length > 0)) rows.push(row)
      row = []
      value = ''
      continue
    }

    value += ch
  }

  row.push(value)
  if (row.some(cell => cell.trim().length > 0)) rows.push(row)
  return rows
}

function parseCsv(fileName: string, text: string, language: TableDataLanguage): ParseTableFileResult {
  const clean = text.replace(/^\uFEFF/, '')
  const rows = parseCsvRows(clean)
  if (rows.length < 2) return { ok: false, error: tableMessage(language, 'csvRows') }
  const columns = dedupeColumns(rows[0])
  const dataRows = rows.slice(1).map(values => {
    const row: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      row[column] = values[index] ?? ''
    })
    return row
  })
  return finalize(fileName, columns, dataRows, language)
}

function parseJson(fileName: string, text: string, language: TableDataLanguage): ParseTableFileResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { ok: false, error: tableMessage(language, 'jsonParse') }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: tableMessage(language, 'jsonArray') }
  }
  if (!parsed.every(isPlainRecord)) {
    return { ok: false, error: tableMessage(language, 'jsonObjects') }
  }
  const rows = parsed as Record<string, unknown>[]
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
  return finalize(fileName, columns, rows, language)
}

async function parseWorkbook(fileName: string, buffer: ArrayBuffer, language: TableDataLanguage): Promise<ParseTableFileResult> {
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet) return { ok: false, error: tableMessage(language, 'excelSheet') }

    const headerRow = sheet.getRow(1)
    let columnCount = headerRow.cellCount
    sheet.eachRow(row => {
      columnCount = Math.max(columnCount, row.cellCount)
    })
    const columns = Array.from({ length: columnCount }, (_, index) =>
      normalizeHeader(headerRow.getCell(index + 1).value, index),
    )
    const dedupedColumns = dedupeColumns(columns)
    if (dedupedColumns.length === 0) return { ok: false, error: tableMessage(language, 'excelHeader') }

    const rows: Record<string, unknown>[] = []
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const item: Record<string, unknown> = {}
      let hasValue = false
      dedupedColumns.forEach((column, index) => {
        const raw = row.getCell(index + 1).value
        const value = raw && typeof raw === 'object' && 'text' in raw ? String(raw.text ?? '') : raw ?? ''
        if (String(value).trim().length > 0) hasValue = true
        item[column] = value
      })
      if (hasValue) rows.push(item)
    })

    return finalize(fileName, dedupedColumns, rows, language)
  } catch {
    return { ok: false, error: tableMessage(language, 'excelParse') }
  }
}

function readAsArrayBuffer(file: File, language: TableDataLanguage): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error(tableMessage(language, 'fileRead')))
    reader.readAsArrayBuffer(file)
  })
}

function readAsText(file: File, language: TableDataLanguage): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error(tableMessage(language, 'fileRead')))
    reader.readAsText(file, 'utf-8')
  })
}

export async function parseTableFile(file: File, language: TableDataLanguage = 'ko'): Promise<ParseTableFileResult> {
  const name = file.name
  const lower = name.toLowerCase()
  try {
    if (lower.endsWith('.csv')) return parseCsv(name, await readAsText(file, language), language)
    if (lower.endsWith('.json')) return parseJson(name, await readAsText(file, language), language)
    if (lower.endsWith('.xlsx')) return parseWorkbook(name, await readAsArrayBuffer(file, language), language)
    return { ok: false, error: tableMessage(language, 'unsupported') }
  } catch {
    return { ok: false, error: tableMessage(language, 'fileRead') }
  }
}

export async function buildExcelWorkbookBase64(
  columns: string[],
  rows: Record<string, unknown>[],
  sheetName = 'data',
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns.map(column => ({
    header: column,
    key: column,
    width: Math.max(10, Math.min(40, column.length + 4)),
  }))
  rows.forEach(row => {
    const item: Record<string, string | number | boolean | Date | null> = {}
    columns.forEach(column => {
      item[column] = normalizeWorkbookCell(row[column])
    })
    sheet.addRow(item)
  })
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  const buffer = await workbook.xlsx.writeBuffer()
  return workbookBufferToBase64(buffer)
}
