import { useState } from 'react'
import { LANGUAGE_OPTIONS, type LanguagePreference, useI18n } from '../../i18n'
import {
  loadShortcutSaveClosePreference,
  saveShortcutSaveClosePreference,
  type ShortcutSaveClosePreference,
} from '../../utils/shortcutSavePreference'

function optionClassName(active: boolean): string {
  return `settings-language-option${active ? ' settings-language-option-active' : ''}`
}

const SHORTCUT_SAVE_OPTIONS: Array<{
  value: ShortcutSaveClosePreference
  labelKey: 'settings.shortcutSave.ask' | 'settings.shortcutSave.close' | 'settings.shortcutSave.keepOpen'
  descriptionKey: 'settings.shortcutSave.ask.description' | 'settings.shortcutSave.close.description' | 'settings.shortcutSave.keepOpen.description'
}> = [
  { value: 'ask', labelKey: 'settings.shortcutSave.ask', descriptionKey: 'settings.shortcutSave.ask.description' },
  { value: 'close', labelKey: 'settings.shortcutSave.close', descriptionKey: 'settings.shortcutSave.close.description' },
  { value: 'keep-open', labelKey: 'settings.shortcutSave.keepOpen', descriptionKey: 'settings.shortcutSave.keepOpen.description' },
]

export default function SettingsPage(): JSX.Element {
  const {
    language,
    languagePreference,
    systemLanguage,
    setLanguagePreference,
    t,
  } = useI18n()

  const languageName = t(language === 'ko' ? 'language.ko' : 'language.en')
  const systemLanguageName = t(systemLanguage === 'ko' ? 'language.ko' : 'language.en')
  const [shortcutSavePreference, setShortcutSavePreference] = useState<ShortcutSaveClosePreference>(loadShortcutSaveClosePreference)

  const handleShortcutSavePreferenceChange = (preference: ShortcutSaveClosePreference): void => {
    setShortcutSavePreference(preference)
    saveShortcutSaveClosePreference(preference)
  }

  return (
    <main className="settings-page">
      <div className="settings-page-inner">
        <header className="settings-page-header">
          <span className="settings-page-kicker">{t('settings.section.general')}</span>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </header>

        <section className="settings-section">
          <div className="settings-section-header">
            <h2>{t('settings.language.title')}</h2>
            <p>{t('settings.language.description')}</p>
          </div>

          <div className="settings-current-language">
            <span>{t('settings.language.current', { language: languageName })}</span>
            <span>{t('settings.language.detected', { language: systemLanguageName })}</span>
          </div>

          <div className="settings-language-options" role="radiogroup" aria-label={t('settings.language.title')}>
            {LANGUAGE_OPTIONS.map(option => {
              const active = languagePreference === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className={optionClassName(active)}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLanguagePreference(option.value as LanguagePreference)}
                >
                  <span className="settings-language-radio" aria-hidden="true" />
                  <span className="settings-language-copy">
                    <strong>{t(option.labelKey)}</strong>
                    <span>{t(option.descriptionKey)}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <p className="settings-note">{t('settings.language.appliedImmediately')}</p>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <h2>{t('settings.shortcutSave.title')}</h2>
            <p>{t('settings.shortcutSave.description')}</p>
          </div>

          <div className="settings-language-options" role="radiogroup" aria-label={t('settings.shortcutSave.title')}>
            {SHORTCUT_SAVE_OPTIONS.map(option => {
              const active = shortcutSavePreference === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className={optionClassName(active)}
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleShortcutSavePreferenceChange(option.value)}
                >
                  <span className="settings-language-radio" aria-hidden="true" />
                  <span className="settings-language-copy">
                    <strong>{t(option.labelKey)}</strong>
                    <span>{t(option.descriptionKey)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
