import type { ReportIncludeOptions } from './reportGenerator'

export type EndReportIncludeConfigKey =
  | 'reportIncludeInput'
  | 'reportIncludeOutput'
  | 'reportIncludePreRequest'
  | 'reportIncludePostResponse'
  | 'reportIncludeVariables'

export function endReportIncludeOptions(config: Partial<EndNodeConfig> | null | undefined): ReportIncludeOptions {
  return {
    input: config?.reportIncludeInput !== false,
    output: config?.reportIncludeOutput !== false,
    preRequest: config?.reportIncludePreRequest !== false,
    postResponse: config?.reportIncludePostResponse !== false,
    variables: config?.reportIncludeVariables !== false,
  }
}

export function endReportIncludeState(config: Partial<EndNodeConfig> | null | undefined): Record<EndReportIncludeConfigKey, boolean> {
  const include = endReportIncludeOptions(config)
  return {
    reportIncludeInput: include.input,
    reportIncludeOutput: include.output,
    reportIncludePreRequest: include.preRequest,
    reportIncludePostResponse: include.postResponse,
    reportIncludeVariables: include.variables,
  }
}
