import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useMonacoTheme } from '../../utils/useMonacoTheme'
import { useI18n } from '../../i18n'

type JsonTemplateSuggestions = {
  envVarNames?: string[]
  inputKeys?: string[]
}

interface Props {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  error?: boolean
  path: string
  placeholder?: string
  templateSuggestions?: JsonTemplateSuggestions
}

const MonacoEditor = lazy(async () => {
  await import('../../utils/monacoSetup')
  return import('@monaco-editor/react')
})

const A8A_JSON_TEMPLATE_LANGUAGE = 'a8a-json-template'

const completionByUri = new Map<string, Required<JsonTemplateSuggestions>>()
let jsonTemplateCompletionRegistered = false
let jsonTemplateLanguageRegistered = false
let completionLabels = {
  envDetail: 'A8A environment variable',
  inputDetail: 'A8A INPUT variable',
}

function detectTemplateTrigger(
  value: string,
  caretPos: number,
): { type: 'env' | 'input'; query: string; start: number } | null {
  const before = value.slice(0, caretPos)
  const envOpen = before.lastIndexOf('{{')
  const envClose = before.lastIndexOf('}}')
  if (envOpen > envClose) return { type: 'env', query: before.slice(envOpen + 2), start: envOpen }
  const inputOpen = before.lastIndexOf('[[')
  const inputClose = before.lastIndexOf(']]')
  if (inputOpen > inputClose) return { type: 'input', query: before.slice(inputOpen + 2), start: inputOpen }
  return null
}

function registerJsonTemplateLanguage(monaco: Monaco): void {
  if (jsonTemplateLanguageRegistered) return
  jsonTemplateLanguageRegistered = true

  if (!monaco.languages.getLanguages().some(language => language.id === A8A_JSON_TEMPLATE_LANGUAGE)) {
    monaco.languages.register({ id: A8A_JSON_TEMPLATE_LANGUAGE })
  }

  monaco.languages.setLanguageConfiguration(A8A_JSON_TEMPLATE_LANGUAGE, {
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  })

  monaco.languages.setMonarchTokensProvider(A8A_JSON_TEMPLATE_LANGUAGE, {
    tokenizer: {
      root: [
        [/\{\{.*?\}\}/, 'variable.predefined'],
        [/\[\[.*?\]\]/, 'variable.predefined'],
        [/"(?:[^"\\]|\\.)*"\s*(?=:)/, 'type.identifier'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false)\b/, 'keyword'],
        [/\bnull\b/, 'constant'],
        [/[{}[\]]/, '@brackets'],
        [/[,:]/, 'delimiter'],
        [/\s+/, 'white'],
      ],
    },
  })
}

function registerJsonTemplateCompletion(monaco: Monaco): void {
  if (jsonTemplateCompletionRegistered) return
  jsonTemplateCompletionRegistered = true

  const registerProvider = (languageId: string) => monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['{', '['],
    provideCompletionItems(model, position) {
      const suggestionsConfig = completionByUri.get(model.uri.toString())
      if (!suggestionsConfig) return { suggestions: [] }

      const line = model.getLineContent(position.lineNumber)
      const trigger = detectTemplateTrigger(line, position.column - 1)
      const pool = trigger?.type === 'env' ? suggestionsConfig.envVarNames : suggestionsConfig.inputKeys
      const query = trigger?.query.toLowerCase() ?? ''
      const names = query ? pool.filter(name => name.toLowerCase().includes(query)) : pool
      const startColumn = trigger ? trigger.start + 1 : position.column
      const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column)
      const kind = monaco.languages.CompletionItemKind.Variable

      return {
        suggestions: names.slice(0, 80).map(name => ({
          label: trigger?.type === 'env' ? `{{${name}}}` : `[[${name}]]`,
          kind,
          detail: trigger?.type === 'env' ? completionLabels.envDetail : completionLabels.inputDetail,
          insertText: trigger?.type === 'env' ? `{{${name}}}` : `[[${name}]]`,
          range,
        })),
      }
    },
  })

  registerProvider('json')
  registerProvider(A8A_JSON_TEMPLATE_LANGUAGE)
}

const beforeMount: BeforeMount = (monaco) => {
  registerJsonTemplateLanguage(monaco)
  registerJsonTemplateCompletion(monaco)
}

const baseOptions: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  folding: true,
  formatOnPaste: true,
  formatOnType: true,
  fontSize: 12,
  glyphMargin: false,
  lineHeight: 20,
  lineNumbers: 'on',
  minimap: { enabled: false },
  overviewRulerBorder: false,
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'on',
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
}

export default function JsonMonacoEditor({
  value,
  onChange,
  readOnly = false,
  error = false,
  path,
  placeholder = 'JSON',
  templateSuggestions,
}: Props): JSX.Element {
  const { t } = useI18n()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const uri = useMemo(() => `a8a://json/${path}`, [path])
  const hasValue = value.trim().length > 0
  const language = templateSuggestions ? A8A_JSON_TEMPLATE_LANGUAGE : 'json'
  const monacoTheme = useMonacoTheme()

  completionLabels = {
    envDetail: t('module.monaco.envDetail'),
    inputDetail: t('module.monaco.inputDetail'),
  }

  useEffect(() => {
    if (!templateSuggestions) {
      completionByUri.delete(uri)
      return
    }
    completionByUri.set(uri, {
      envVarNames: templateSuggestions.envVarNames ?? [],
      inputKeys: templateSuggestions.inputKeys ?? [],
    })
    return () => { completionByUri.delete(uri) }
  }, [templateSuggestions, uri])

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance
  }

  return (
    <div className={`json-monaco-wrap${error ? ' json-monaco-wrap-error' : ''}`}>
      {!hasValue && <div className="json-monaco-placeholder">{placeholder}</div>}
      <Suspense fallback={<div className="dm-monaco-loading">{t('module.monaco.loading')}</div>}>
        <MonacoEditor
          height="100%"
          language={language}
          path={uri}
          theme={monacoTheme}
          value={value}
          beforeMount={beforeMount}
          onMount={handleMount}
          onChange={(next: string | undefined) => onChange?.(next ?? '')}
          options={{ ...baseOptions, readOnly, domReadOnly: readOnly }}
        />
      </Suspense>
    </div>
  )
}
