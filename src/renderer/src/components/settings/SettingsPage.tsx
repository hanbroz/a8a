import { LANGUAGE_OPTIONS, type LanguagePreference, useI18n } from '../../i18n'

function optionClassName(active: boolean): string {
  return `settings-language-option${active ? ' settings-language-option-active' : ''}`
}

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
      </div>
    </main>
  )
}
