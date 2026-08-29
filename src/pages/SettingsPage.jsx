import React, { useState } from 'react'
import { useStore } from '../store'
import { uid } from '../lib/storage'
import { CAPABILITY_LABELS, discoverProvider, inferProviderCapabilities } from '../lib/llm'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../lib/llm'
import { TOKEN_CREATE_URL } from '../lib/github'
import { verifyRepositoryConnection } from '../lib/repositories'
import { getProfile, Avatar } from '../lib/profile.jsx'
import { supabase } from '../lib/supabase'
import ConfirmSheet from '../components/ConfirmSheet'
import {
  IconTrash, IconGear, IconShieldCheck, IconChat, IconBack, IconChevronDown, IconRefresh, IconCheck,
  IconGitHub, IconBranch, IconFolder,
} from '../components/Icons'

let deferredInstallPrompt = null
const installListeners = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredInstallPrompt = event
    for (const notify of installListeners) notify(true)
  })
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    for (const notify of installListeners) notify(false)
  })
}

const EFFORTS = [
  ['low', 'Низкая'],
  ['medium', 'Средняя'],
  ['high', 'Высокая'],
]

const CTX_LIMITS = [
  ['8000', '8 000 символов'],
  ['16000', '16 000 символов'],
  ['24000', '24 000 символов'],
  ['96000', '96 000 символов'],
  ['200000', '200 000 символов'],
  ['48000', '48 000 символов'],
]

const THEMES = [
  ['black', 'Чёрная', '#000000'],
  ['graphite', 'Графит', '#111214'],
  ['midnight', 'Полночь', '#090d18'],
  ['light', 'Светлая', '#f5f5f7'],
]

const OUTPUT_LIMITS = [
  ['8192', '8 192 — короткие ответы'],
  ['16000', '16 000'],
  ['32000', '32 000 — по умолчанию'],
  ['64000', '64 000 — очень длинные файлы'],
]

const FONT_SCALES = [[90, 'Мелкий'], [100, 'Обычный'], [110, 'Крупный'], [120, 'Очень крупный']]

const emptyForm = { baseUrl: '', apiKey: '' }

// Подключение аккаунта GitHub. OAuth-редирект мобильному приложению без сервера
// недоступен, поэтому вход идёт по personal access token: он создаётся по ссылке
// с уже выбранными правами и хранится только на устройстве.
function GitHubSection() {
  const store = useStore()
  const account = store.settings.github
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    const ok = await store.connectGitHub(token)
    setBusy(false)
    if (ok) setToken('')
  }

  if (account?.login) {
    return (
      <section className="set-sect gh-section">
        <h3>Аккаунт</h3>
        <div className="gh-account">
          {account.avatarUrl
            ? <img className="gh-avatar" src={account.avatarUrl} alt="" />
            : <span className="gh-avatar gh-avatar-empty"><IconGitHub width={20} height={20} /></span>}
          <span className="grow sp-text">
            <span className="sp-title">{account.name}</span>
            <span className="sp-sub">@{account.login}</span>
          </span>
        </div>
        <p className="set-note">
          Доступны свои и командные репозитории, включая приватные: загрузка в разделе «Файлы»,
          коммит и push оттуда же. Любая модель с поддержкой инструментов может также читать статус,
          ветки и коммиты, а по вашему подтверждению выполнять pull, создавать ветки, push и Pull Request.
          Токен хранится только на этом устройстве.
        </p>
        <div className="row">
          <button className="btn" onClick={() => store.disconnectGitHub()}>Отключить аккаунт</button>
        </div>
      </section>
    )
  }

  return (
    <section className="set-sect gh-section gh-connect-section">
      <h3>Подключить аккаунт</h3>
      <p className="set-note">
        Создайте personal access token — ссылка ниже открывает форму GitHub с уже выбранными
        правами <b>repo</b> и <b>read:user</b>. Скопируйте токен и вставьте его здесь.
      </p>
      <div className="row gh-token-action">
        <a className="btn" href={TOKEN_CREATE_URL} target="_blank" rel="noreferrer">
          <IconGitHub width={15} height={15} /> Создать токен на GitHub
        </a>
      </div>
      <input
        className="input gh-token-input"
        type="password"
        autoComplete="off"
        placeholder="ghp_… или github_pat_…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <div className="row gh-connect-action">
        <button className="btn btn-primary" onClick={connect} disabled={busy || !token.trim()}>
          {busy ? 'Проверяю…' : 'Подключить'}
        </button>
      </div>
    </section>
  )
}

// Цена задаётся вручную для выбранной модели: единого справочника тарифов у
// OpenAI-совместимых провайдеров нет, а придумывать цифры за провайдера нельзя.
function ModelPriceSection() {
  const { settings, setSettings } = useStore()
  const selected = settings.selected
  const provider = settings.providers.find((p) => p.id === selected?.providerId)
  if (!provider || !selected?.model) return null

  const key = `${provider.id}:${selected.model}`
  const price = settings.modelPrices?.[key] || {}
  const setPrice = (field, value) => {
    setSettings((s) => {
      const next = { ...(s.modelPrices || {}) }
      const cur = { ...(next[key] || {}) }
      if (value === '') delete cur[field]
      else cur[field] = Number(value)
      if (Object.keys(cur).length) next[key] = cur
      else delete next[key]
      return { ...s, modelPrices: next }
    })
  }

  return (
    <section className="set-sect">
      <h3>Стоимость запросов</h3>
      <p className="set-note">
        Расход токенов приложение берёт из ответа провайдера, а цену знаете только вы.
        Укажите тариф модели <b>{selected.model}</b> — под ответами появится стоимость.
      </p>
      <div className="row price-row">
        <label className="field">
          <span>Вход, $ за 1M</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="напр. 3"
            value={price.input ?? ''}
            onChange={(e) => setPrice('input', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Выход, $ за 1M</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="напр. 15"
            value={price.output ?? ''}
            onChange={(e) => setPrice('output', e.target.value)}
          />
        </label>
      </div>
    </section>
  )
}

const REPOSITORY_SOURCES = [
  { id: 'github', title: 'GitHub', description: 'Клонирование, ветки, commit, push и Pull Request', Icon: IconGitHub, ready: true },
  { id: 'gitlab', title: 'GitLab', description: 'Подключение токена и доступ к вашему профилю', Icon: IconBranch },
  { id: 'bitbucket', title: 'Bitbucket', description: 'Подключение через App password', Icon: IconFolder },
  { id: 'git', title: 'Любой Git URL', description: 'HTTPS или SSH-ссылка на репозиторий', Icon: IconBranch },
]

function RepositorySourceConnection({ kind, saved, onSave }) {
  const store = useStore()
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl || (kind === 'gitlab' ? 'https://gitlab.com' : ''))
  const [token, setToken] = useState('')
  const [username, setUsername] = useState(saved?.username || '')
  const [appPassword, setAppPassword] = useState('')
  const [url, setUrl] = useState(saved?.baseUrl || '')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await verifyRepositoryConnection(kind, { baseUrl, token, username, appPassword, url })
      onSave({
        kind,
        baseUrl: result.baseUrl,
        login: result.login,
        username: kind === 'bitbucket' ? username.trim() : undefined,
        connectedAt: Date.now(),
      })
      setToken('')
      setAppPassword('')
      store.toast(kind === 'git' ? 'Git-ссылка сохранена' : `Подключено: ${result.login}`)
    } catch (error) {
      store.toast(`${kind === 'gitlab' ? 'GitLab' : kind === 'bitbucket' ? 'Bitbucket' : 'Git'}: ${error.message}`)
    } finally { setBusy(false) }
  }

  if (kind === 'gitlab') return <>
    <div className="field"><label>Адрес GitLab</label><input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.com" /></div>
    <div className="field"><label>Personal Access Token</label><input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={saved?.login ? 'Введите новый токен для переподключения' : 'glpat-…'} /></div>
    <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={connect}>{busy ? 'Проверяю…' : saved ? 'Переподключить GitLab' : 'Подключить GitLab'}</button>
  </>
  if (kind === 'bitbucket') return <>
    <div className="field"><label>Имя пользователя Bitbucket</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" /></div>
    <div className="field"><label>App password</label><input className="input" type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="Создаётся в Bitbucket → Personal settings" /></div>
    <button className="btn btn-primary" disabled={busy || !username.trim() || !appPassword.trim()} onClick={connect}>{busy ? 'Проверяю…' : saved ? 'Переподключить Bitbucket' : 'Подключить Bitbucket'}</button>
  </>
  return <>
    <div className="field"><label>Адрес репозитория</label><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="none" placeholder="https://host/team/project.git или git@host:team/project.git" /></div>
    <button className="btn btn-primary" disabled={busy || !url.trim()} onClick={connect}>{saved ? 'Обновить ссылку' : 'Сохранить ссылку'}</button>
  </>
}

function RepositoriesSection() {
  const { settings, setSettings } = useStore()
  const connections = settings.repositoryConnections || {}
  const [active, setActive] = useState('github')
  const source = REPOSITORY_SOURCES.find((item) => item.id === active)

  const save = (next) => setSettings((current) => ({
    ...current,
    repositoryConnections: { ...(current.repositoryConnections || {}), [active]: next },
  }))
  const disconnect = () => setSettings((current) => {
    const next = { ...(current.repositoryConnections || {}) }
    delete next[active]
    return { ...current, repositoryConnections: next }
  })

  return <>
    <section className="set-sect">
      <h3>Источники репозиториев</h3>
      <p className="set-note">Подключите нужный источник. Токены остаются только на устройстве. GitHub поддерживает работу с проектом целиком и доступен агентам всех провайдеров, которые умеют вызывать инструменты; любое действие, меняющее репозиторий, требует вашего подтверждения. Для остальных источников сейчас проверяется учётная запись и сохраняется подключение.</p>
      <div className="repo-source-list">
        {REPOSITORY_SOURCES.map(({ id, title, description, Icon, ready }) => {
          const connected = id === 'github' ? !!settings.github?.login : !!connections[id]?.connectedAt
          return <button key={id} className={'repo-source ' + (active === id ? 'active' : '')} onClick={() => setActive(id)}>
            <span className="repo-source-icon"><Icon width={19} height={19} /></span>
            <span className="grow repo-source-text"><b>{title}</b><small>{description}</small></span>
            {connected ? <span className="repo-state ok"><IconCheck width={15} height={15} /> Подключён</span> : ready ? <span className="repo-state">Готов</span> : <span className="repo-state">Добавить</span>}
          </button>
        })}
      </div>
    </section>
    {active === 'github' ? <GitHubSection /> : <section className="set-sect gh-section repo-connect-card">
      <h3>{source.title}</h3>
      {connections[active]?.login && <div className="repo-connected"><IconCheck width={17} height={17} /> <span>Подключено: <b>{connections[active].login}</b></span></div>}
      <RepositorySourceConnection kind={active} saved={connections[active]} onSave={save} />
      {connections[active]?.connectedAt && <button className="btn repo-disconnect" onClick={disconnect}>Удалить подключение</button>}
      <p className="set-note">{active === 'git' ? 'Это сохранённая ссылка. Для закрытых репозиториев используйте HTTPS-token URL или SSH-ключ, когда добавим открытие проекта из этого источника.' : 'Проверка выполняет только безопасный запрос профиля. Репозитории, клонирование и push для этого источника будут подключены следующим шагом.'}</p>
    </section>}
  </>
}

function InstallAppControl() {
  const [available, setAvailable] = useState(!!deferredInstallPrompt)
  const standalone = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone
  )
  React.useEffect(() => {
    installListeners.add(setAvailable)
    return () => installListeners.delete(setAvailable)
  }, [])
  const install = async () => {
    if (!deferredInstallPrompt) return
    const prompt = deferredInstallPrompt
    await prompt.prompt()
    await prompt.userChoice
    deferredInstallPrompt = null
    setAvailable(false)
  }
  if (standalone) return <p className="set-note"><b>VerbaIDE уже установлена</b> и открыта как отдельное приложение.</p>
  return (
    <>
      <button className="btn btn-primary" onClick={install} disabled={!available}>Установить VerbaIDE</button>
      <p className="set-note">
        {available
          ? 'Приложение откроется без браузерной панели и останется на главном экране.'
          : 'Если кнопка недоступна, откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».'}
      </p>
    </>
  )
}

export default function SettingsPage() {
  const store = useStore()
  const { settings, setSettings } = store
  const [section, setSection] = useState(null)
  const [modelSearch, setModelSearch] = useState({})
  const { uid: deviceUid } = getProfile()
  const [account, setAccount] = useState(null)

  React.useEffect(() => {
    if (!supabase) return undefined
    let active = true
    supabase.auth.getUser().then(({ data }) => { if (active) setAccount(data.user || null) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAccount(session?.user || null)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const profileMeta = account?.user_metadata || {}
  const profileTitle = profileMeta.telegram_username
    ? '@' + profileMeta.telegram_username
    : (profileMeta.full_name || account?.email || 'Локальный профиль')
  const profileSubtitle = profileMeta.provider === 'telegram'
    ? 'Вход через Telegram'
    : account ? 'Аккаунт VerbaIDE' : 'Создаётся автоматически на этом устройстве'

  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(deviceUid)
      store.toast('UID скопирован')
    } catch {
      store.toast(deviceUid)
    }
  }
  const switchAccount = async () => {
    try { await supabase?.auth.signOut() } catch { /* локальный режим всё равно можно сменить */ }
    try { localStorage.removeItem('verbaide.access-mode') } catch { /* ignore */ }
    window.location.reload()
  }
  const [form, setForm] = useState(emptyForm)
  const [testingId, setTestingId] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)

  const connectProvider = async () => {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) {
      store.toast('Укажите endpoint и API key')
      return
    }
    setConnecting(true)
    try {
      const found = await discoverProvider(form)
      const existing = settings.providers.find((p) => p.baseUrl === found.baseUrl)
      const provider = { ...found, id: existing?.id || uid(), name: existing?.name || found.name }
      setSettings((s) => {
        const providers = existing
          ? s.providers.map((p) => p.id === provider.id ? provider : p)
          : [...s.providers, provider]
        let selected = s.selected
        if (!selected) selected = { providerId: provider.id, model: provider.models[0] }
        else if (selected.providerId === provider.id && !provider.models.includes(selected.model)) {
          selected = { providerId: provider.id, model: provider.models[0] }
        }
        return { ...s, providers, selected }
      })
      setForm(emptyForm)
      store.toast(`${provider.name}: подключено моделей — ${provider.models.length}`)
    } catch (e) {
      store.toast('Не удалось подключить: ' + e.message)
    } finally {
      setConnecting(false)
    }
  }

  const removeProvider = (id) => {
    setSettings((s) => ({
      ...s,
      providers: s.providers.filter((p) => p.id !== id),
      selected: s.selected?.providerId === id ? null : s.selected,
    }))
  }

  const selectModel = (providerId, model) => setSettings((s) => ({ ...s, selected: { providerId, model } }))

  const refreshProvider = async (p) => {
    setTestingId(p.id)
    try {
      const found = await discoverProvider(p)
      setSettings((s) => {
        const updated = { ...p, ...found, id: p.id, name: p.name }
        const providers = s.providers.map((item) => item.id === p.id ? updated : item)
        const selected = s.selected?.providerId === p.id && !updated.models.includes(s.selected.model)
          ? { providerId: p.id, model: updated.models[0] }
          : s.selected
        return { ...s, providers, selected }
      })
      store.toast(`${p.name}: найдено моделей — ${found.models.length}`)
    } catch (e) {
      store.toast(p.name + ': ' + e.message)
    } finally {
      setTestingId(null)
    }
  }

  const effortLabel = EFFORTS.find((e) => e[0] === (settings.effort || 'high'))?.[1]

  const SECTIONS = [
    {
      id: 'providers',
      title: 'Провайдеры',
      Icon: IconGear,
      sub: settings.providers.length
        ? `${settings.providers.length} подключено · ${settings.selected?.model || 'модель не выбрана'}`
        : 'Не настроено',
    },
    {
      id: 'agent',
      title: 'Агент',
      Icon: IconShieldCheck,
      sub: settings.confirmForMe ? 'Правки применяются автоматически' : 'Правки с подтверждением',
    },
    {
      id: 'chat',
      title: 'Чат',
      Icon: IconChat,
      sub: 'Старательность: ' + effortLabel,
    },
    {
      id: 'language',
      title: settings.locale === 'en' ? 'Language' : 'Язык интерфейса',
      Icon: IconChat,
      sub: settings.locale === 'en' ? 'English' : 'Русский',
    },
    {
      id: 'repositories',
      title: 'Репозитории',
      Icon: IconBranch,
      sub: settings.github?.login
        ? 'GitHub подключён · другие источники'
        : 'GitHub, GitLab, Bitbucket и Git URL',
    },
    {
      id: 'data',
      title: 'Данные',
      Icon: IconTrash,
      sub: 'Очистка и о приложении',
    },
  ]

  return (
    <div className="page settings-page">
      {!section ? (
        <>
          <div className="set-list">
            <div className="profile-card">
              {profileMeta.avatar_url
                ? <img className="profile-account-avatar" src={profileMeta.avatar_url} alt="" referrerPolicy="no-referrer" />
                : <Avatar size={52} />}
              <span className="grow sp-text">
                <span className="sp-title">{profileTitle}</span>
                <span className="sp-sub">{profileSubtitle}</span>
              </span>
              <button className="profile-uid" onClick={copyUid} title="Скопировать UID устройства">
                {account ? 'UID' : deviceUid}
              </button>
            </div>
            <button className="set-panel" onClick={switchAccount}>
              <span className="sp-icon"><IconShieldCheck width={19} height={19} /></span>
              <span className="grow sp-text"><span className="sp-title">Войти или сменить аккаунт</span><span className="sp-sub">Email-код, Telegram, Google или гостевой режим</span></span>
              <IconChevronDown width={15} height={15} className="twist" />
            </button>

            {SECTIONS.map(({ id, title, Icon, sub }) => (
            <button key={id} className="set-panel" onClick={() => setSection(id)}>
              <span className="sp-icon">
                <Icon width={19} height={19} />
              </span>
              <span className="grow sp-text">
                <span className="sp-title">{title}</span>
                <span className="sp-sub">{sub}</span>
              </span>
              <IconChevronDown width={15} height={15} className="twist" />
            </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="set-subhead">
            <button className="iconbtn" onClick={() => setSection(null)} aria-label="Назад">
              <IconBack width={18} height={18} />
            </button>
            <b>{SECTIONS.find((s) => s.id === section)?.title}</b>
          </div>

          <div className="set-body">
            {section === 'providers' && (
          <>
            <section className="set-sect">
              <h3>Подключённые</h3>
              {settings.providers.length === 0 && (
                <p className="hero-dim">Пока нет провайдеров. Добавьте свой API-эндпоинт ниже.</p>
            )}
            {section === 'language' && (
              <section className="set-sect">
                <h3>{settings.locale === 'en' ? 'Interface language' : 'Язык интерфейса'}</h3>
                <p className="set-note">{settings.locale === 'en' ? 'Choose the language used by the VerbaIDE interface.' : 'Выберите язык интерфейса VerbaIDE.'}</p>
                <div className="theme-choice">
                  <button className={settings.locale !== 'en' ? 'active' : ''} onClick={() => setSettings((s) => ({ ...s, locale: 'ru' }))}>Русский <small>RU</small></button>
                  <button className={settings.locale === 'en' ? 'active' : ''} onClick={() => setSettings((s) => ({ ...s, locale: 'en' }))}>English <small>EN</small></button>
                </div>
              </section>
            )}
              {settings.providers.map((p) => (
                <div key={p.id} className="prov-card">
                  <div className="prov-top">
                    <b>{p.name}</b>
                    <span className="badge">{p.format === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                    <span className="grow" />
                    <button className="iconbtn danger" onClick={() => removeProvider(p.id)} aria-label={'Удалить провайдера ' + p.name} title="Удалить провайдера">
                      <IconTrash width={15} height={15} />
                    </button>
                  </div>
                  <div className="prov-url">{p.baseUrl}</div>
                  <div className="cap-grid">
                    {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                      const caps = p.capabilities || inferProviderCapabilities(p)
                      const supported = !!caps[key]
                      return <span key={key} className={'cap-chip ' + (supported ? 'yes' : 'no')} title={supported ? 'Доступно по результату сканирования' : 'Не обнаружено у этого endpoint/набора моделей'}>{supported ? '✓' : '—'} {label}</span>
                    })}
                  </div>
                  <div className="cap-note">Определено по типу endpoint и списку доступных моделей. Недоступные функции скрываются или блокируются в чате.</div>
                  <div className="provider-model-search">
                    <input className="input" value={modelSearch[p.id] || ''} onChange={(e) => setModelSearch((all) => ({ ...all, [p.id]: e.target.value }))} placeholder={`Поиск среди ${p.models.length} моделей…`} aria-label={`Поиск моделей ${p.name}`} />
                  </div>
                  <div className="chips">
                    {p.models.filter((m) => m.toLowerCase().includes((modelSearch[p.id] || '').trim().toLowerCase())).slice(0, 32).map((m) => {
                      const sel = settings.selected?.providerId === p.id && settings.selected?.model === m
                      return (
                        <button key={m} className={'chip' + (sel ? ' sel' : '')} onClick={() => selectModel(p.id, m)}>
                          {m}
                        </button>
                      )
                    })}
                    {p.models.filter((m) => m.toLowerCase().includes((modelSearch[p.id] || '').trim().toLowerCase())).length > 32 && <span className="chip">ещё {p.models.filter((m) => m.toLowerCase().includes((modelSearch[p.id] || '').trim().toLowerCase())).length - 32}</span>}
                    {p.models.length && !p.models.some((m) => m.toLowerCase().includes((modelSearch[p.id] || '').trim().toLowerCase())) && <span className="hero-dim">Модели не найдены</span>}
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ marginTop: 10 }}
                    disabled={testingId === p.id}
                    onClick={() => refreshProvider(p)}
                  >
                    <IconRefresh width={14} height={14} />
                    {testingId === p.id ? 'Сканирую…' : 'Обновить модели'}
                  </button>
                </div>
              ))}
            </section>

            <section className="set-sect">
              <div className="form-card">
                <div className="form-title">Подключить провайдера</div>
                <div className="form-sub">
                  Введите endpoint и ключ. VerbaIDE проверит API, определит формат и загрузит доступные модели.
                </div>

                <div className="field">
                  <label>API endpoint</label>
                  <input
                    className="input"
                    inputMode="url"
                    placeholder="https://api.example.com/v1"
                    value={form.baseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  />
                  <small className="field-note">Можно вставить и полный путь до /chat/completions или /messages.</small>
                </div>

                <div className="field">
                  <label>API key</label>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder="Вставьте ключ доступа"
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  />
                </div>

                <div className="provider-scan-note">
                  Ключ хранится локально на этом устройстве. Для подключения endpoint должен разрешать запросы из приложения.
                </div>
                <button className="btn btn-primary provider-connect" disabled={connecting} onClick={connectProvider}>
                  <IconRefresh width={15} height={15} className={connecting ? 'spin-icon' : ''} />
                  {connecting ? 'Проверяю и загружаю модели…' : 'Сканировать и подключить'}
                </button>
              </div>
            </section>
          </>
        )}

        {section === 'agent' && (
          <>
            <section className="set-sect">
              <h3>Правки файлов</h3>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.confirmForMe}
                  onChange={(e) => setSettings((s) => ({ ...s, confirmForMe: e.target.checked }))}
                />
                <span>
                  <b>Подтверждать за меня</b>
                  <small>Применять правки агента к файлам проекта автоматически</small>
                </span>
              </label>
            </section>

            <section className="set-sect">
              <h3>Инструменты кодинга</h3>
              <div className="cap-grid">
                <span className="cap-chip yes">Чтение файлов</span>
                <span className="cap-chip yes">Поиск по проекту</span>
                <span className="cap-chip yes">Точечные правки</span>
                <span className="cap-chip yes">Создание файлов</span>
                <span className="cap-chip yes">Build / test / lint</span>
              </div>
              <p className="set-note">
                Проверки запускаются только через локальный dev-сервер и после отдельного подтверждения.
                В APK агент редактирует проект, но системный терминал Android недоступен.
              </p>
            </section>

            <section className="set-sect">
              <h3>Процесс работы</h3>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.showThinking !== false}
                  onChange={(e) => setSettings((s) => ({ ...s, showThinking: e.target.checked }))}
                />
                <span>
                  <b>Показывать ход мыслей</b>
                  <small>Стримить размышления модели в чате, если она их отдаёт</small>
                </span>
              </label>
              <label className="check-row" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={!!settings.anthropicThinking}
                  onChange={(e) => setSettings((s) => ({ ...s, anthropicThinking: e.target.checked }))}
                />
                <span>
                  <b>Extended thinking (Anthropic)</b>
                  <small>Явно запрашивать размышления у моделей Claude (если поддерживают)</small>
                </span>
              </label>
            </section>

            <section className="set-sect">
              <h3>Инструкция агенту</h3>
              <textarea
                className="input ta"
                rows={5}
                placeholder="Например: пиши комментарии на русском, используй TypeScript, не переписывай стили…"
                value={settings.customInstructions || ''}
                onChange={(e) => setSettings((s) => ({ ...s, customInstructions: e.target.value }))}
              />
              <p className="hero-dim">Добавляется к системному промпту в каждом запросе.</p>
            </section>
          </>
        )}

        {section === 'chat' && (
          <>
            <section className="set-sect">
              <h3>Оформление</h3>
              <div className="theme-options">
                {THEMES.map(([id, label, color]) => (
                  <button key={id} className={'theme-choice' + ((settings.theme || 'black') === id ? ' on' : '')} onClick={() => setSettings((s) => ({ ...s, theme: id }))}>
                    <i style={{ background: color }} /> <span>{label}</span>{(settings.theme || 'black') === id && <IconCheck />}
                  </button>
                ))}
              </div>
              <div className="field" style={{ marginTop: 14 }}>
                <label>Размер текста</label>
                <div className="font-options">
                  {FONT_SCALES.map(([size, label]) => (
                    <button key={size} className={(settings.fontScale || 100) === size ? 'on' : ''} onClick={() => setSettings((s) => ({ ...s, fontScale: size }))}>
                      <b style={{ fontSize: `${11 * size / 100}px` }}>Aa</b><span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="set-sect">
              <h3>Удобство и доступность</h3>
              <label className="check-row">
                <input type="checkbox" checked={settings.autoRotate !== false} onChange={(e) => setSettings((s) => ({ ...s, autoRotate: e.target.checked }))} />
                <span><b>Автоповорот и планшетный режим</b><small>В альбомной ориентации интерфейс использует доступную ширину; при выключении фиксируется портретный режим, если Android это разрешает.</small></span>
              </label>
              <label className="check-row" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={settings.haptics !== false} onChange={(e) => setSettings((s) => ({ ...s, haptics: e.target.checked }))} />
                <span><b>Тактильный отклик</b><small>Короткая вибрация для жестов и важных действий в чате.</small></span>
              </label>
              <label className="check-row" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={!!settings.reduceMotion} onChange={(e) => setSettings((s) => ({ ...s, reduceMotion: e.target.checked }))} />
                <span><b>Уменьшить анимацию</b><small>Отключает лишние переходы и анимации набора текста.</small></span>
              </label>
              <label className="check-row" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={!!settings.highContrast} onChange={(e) => setSettings((s) => ({ ...s, highContrast: e.target.checked }))} />
                <span><b>Повышенная контрастность</b><small>Усиливает границы и различимость элементов интерфейса.</small></span>
              </label>
            </section>

            <section className="set-sect">
              <h3>Старательность по умолчанию</h3>
              <div className="seg wide">
                {EFFORTS.map(([v, l]) => (
                  <button
                    key={v}
                    className={(settings.effort || 'high') === v ? 'on' : ''}
                    onClick={() => setSettings((s) => ({ ...s, effort: v }))}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <p className="hero-dim">Меняется и в чате, рядом с выбором модели.</p>
            </section>

            <section className="set-sect">
              <h3>Контекст</h3>
              <div className="field">
                <label>Максимум символов на прикреплённый файл</label>
                <select
                  className="input"
                  value={String(settings.maxFileChars || 24000)}
                  onChange={(e) => setSettings((s) => ({ ...s, maxFileChars: Number(e.target.value) }))}
                >
                  {CTX_LIMITS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <p className="hero-dim">
                Файлы длиннее лимита обрезаются. Если агент «не видит» конец большого файла
                и переписывает его неверно — поднимите значение.
              </p>
            </section>

            <section className="set-sect">
              <h3>Длина ответа</h3>
              <div className="field">
                <label>Максимум токенов на один ответ</label>
                <select
                  className="input"
                  value={String(settings.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS)}
                  onChange={(e) => setSettings((s) => ({ ...s, maxOutputTokens: Number(e.target.value) }))}
                >
                  {OUTPUT_LIMITS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <p className="hero-dim">
                Длинный файл не влезает в один ответ и обрывается на середине. Приложение
                автоматически досылает продолжения и склеивает текст, но чем выше лимит,
                тем реже это нужно. Если провайдер лимит не принимает, запрос уходит без него.
              </p>
            </section>

            <section className="set-sect">
              <h3>Фоновый агент</h3>
              <div className="row">
                <div className="field"><label>Лимит времени</label><select className="input" value={settings.agentLimits?.maxMinutes || 12} onChange={(e) => setSettings((s) => ({ ...s, agentLimits: { ...(s.agentLimits || {}), maxMinutes: Number(e.target.value) } }))}><option value="5">5 мин</option><option value="12">12 мин</option><option value="30">30 мин</option></select></div>
                <div className="field"><label>Лимит ответа</label><select className="input" value={settings.agentLimits?.maxTokens || 24000} onChange={(e) => setSettings((s) => ({ ...s, agentLimits: { ...(s.agentLimits || {}), maxTokens: Number(e.target.value) } }))}><option value="8000">8 000</option><option value="24000">24 000</option><option value="48000">48 000</option></select></div>
              </div>
              <label className="check-row"><input type="checkbox" checked={settings.agentLimits?.notify !== false} onChange={(e) => { if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); setSettings((s) => ({ ...s, agentLimits: { ...(s.agentLimits || {}), notify: e.target.checked } })) }} /> Уведомлять о завершении задачи</label>
              <p className="hero-dim">Лимит стоимости рассчитывается только при заданной цене модели; лимит токенов всегда активен.</p>
            </section>

            <ModelPriceSection />
          </>
        )}

        {section === 'repositories' && <RepositoriesSection />}

        {section === 'data' && (
          <>
            <section className="set-sect">
              <h3>Очистка</h3>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => setConfirmAction({
                    title: 'Очистить историю?',
                    message: 'Все сохранённые чаты будут удалены. Проекты и настройки останутся.',
                    label: 'Очистить чаты',
                    run: store.clearChats,
                  })}
                >
                  Очистить чаты
                </button>
                <button
                  className="btn"
                  onClick={() => setConfirmAction({
                    title: 'Удалить провайдеров?',
                    message: 'Будут удалены все API-подключения и выбранные модели. История чатов останется.',
                    label: 'Удалить провайдеров',
                    run: () => setSettings((s) => ({ ...s, providers: [], selected: null })),
                  })}
                >
                  Удалить провайдеров
                </button>
                {store.project && (
                  <button className="btn" onClick={store.closeProject}>Закрыть проект</button>
                )}
              </div>
              <p className="hero-dim">Ключи, чаты и настройки хранятся только в этом браузере / приложении.</p>
            </section>

            <section className="set-sect">
              <h3>Установка</h3>
              <InstallAppControl />
            </section>

            <section className="set-sect">
              <h3>О приложении</h3>
              <p className="hero-dim">
                VerbaIDE v0.3.0 — мобильная IDE с ИИ-агентом. Агент работает с файлами проекта: структура
                и приложенные файлы отправляются в контекст, правки приходят блоками file:путь.
              </p>
            </section>
          </>
        )}
        </div>
        <ConfirmSheet
          open={!!confirmAction}
          title={confirmAction?.title}
          message={confirmAction?.message}
          confirmLabel={confirmAction?.label}
          danger
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction
            setConfirmAction(null)
            action?.run?.()
          }}
        />
      </>
      )}
    </div>
  )
}
