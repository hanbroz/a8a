function stringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.map(item => String(item)).filter(Boolean))
}

export function resolveEndReportSelectedModuleIds(
  config: Partial<EndNodeConfig>,
  connectedModuleIds: string[],
): Set<string> {
  const hasExplicitSelection = Object.prototype.hasOwnProperty.call(config, 'selectedModuleIds')
  if (!hasExplicitSelection) return new Set(connectedModuleIds)

  const selectedModuleIds = stringSet(config.selectedModuleIds)
  if (!Array.isArray(config.reportCandidateModuleIds)) {
    return new Set(connectedModuleIds.filter(id => selectedModuleIds.has(id)))
  }

  const previousCandidateIds = stringSet(config.reportCandidateModuleIds)

  return new Set(connectedModuleIds.filter(id => selectedModuleIds.has(id) || !previousCandidateIds.has(id)))
}
