import { useI18n } from '../../i18n'
import { getShortcutSaveKeyLabel } from '../../utils/shortcutSavePreference'

interface Props {
  saving?: boolean
}

export default function ShortcutSaveButtonLabel({ saving = false }: Props): JSX.Element {
  const { t } = useI18n()
  if (saving) return <>{t('common.saving')}</>
  return <>{t('common.saveWithShortcut', { shortcut: getShortcutSaveKeyLabel() })}</>
}
