import React, { useEffect, useRef, useState } from 'react'
import { StoreProvider, useStore } from './store'
import Sidebar from './components/Sidebar'
import ChatPage from './pages/ChatPage'
import FilesPage from './pages/FilesPage'
import SettingsPage from './pages/SettingsPage'
import PluginsPage from './pages/PluginsPage'
import MemoryPage from './pages/MemoryPage'
import TasksPage from './pages/TasksPage'
import MediaPage from './pages/MediaPage'
import LoadingScreen from './components/LoadingScreen'
import FileAccessPrompt from './components/FileAccessPrompt'
import CanvasPanel from './components/CanvasPanel'
import AuthScreen, { hasChosenAccess } from './components/AuthScreen'
import { IconMenu, IconEdit } from './components/Icons'
import { supabase } from './lib/supabase'

function Shell() {
  const store = useStore()
  const { page, project, chats, activeChatId, toastMsg, ready, settings, setSettings } = store
  const dirRef = useRef(null)
  const [splashGone, setSplashGone] = useState(false)
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [accessChosen, setAccessChosen] = useState(hasChosenAccess)

  // После возвращения из Telegram/Supabase сессия приходит в URL. Подхватываем
  // её и не оставляем пользователя на экране входа.
  useEffect(() => {
    if (!supabase) return undefined
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) {
        try { localStorage.setItem('verbaide.access-mode', 'supabase') } catch { /* ignore */ }
        setAccessChosen(true)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive || !session) return
      try { localStorage.setItem('verbaide.access-mode', 'supabase') } catch { /* ignore */ }
      setAccessChosen(true)
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  // после готовности даём сплэшу время на плавное исчезновение
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setSplashGone(true), 550)
    return () => clearTimeout(t)
  }, [ready])

  useEffect(() => {
    store.pickersRef.current = {
      pickFolder: () => dirRef.current?.click(),
    }
  })

  // WebView сам адаптируется к планшету и ландшафтному режиму. Пользователь
  // может при необходимости зафиксировать портрет; браузеры без API просто
  // проигнорируют настройку.
  useEffect(() => {
    const orientation = window.screen?.orientation
    if (!orientation) return
    try {
      const result = settings.autoRotate !== false
        ? orientation.unlock?.()
        : orientation.lock?.('portrait')
      // В Android WebView unlock() часто возвращает void, а lock() — Promise.
      // Обрабатываем оба контракта, не вызывая .catch у undefined.
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch { /* ориентация может быть запрещена браузером */ }
  }, [settings.autoRotate])

  let title = 'Чат'
  if (page === 'files') title = project ? project.name : 'Файлы'
  if (page === 'plugins') title = 'Навыки'
  if (page === 'memory') title = 'Память'
  if (page === 'tasks') title = 'Задачи'
  if (page === 'media') title = 'Медиа-студия'
  if (page === 'settings') title = 'Настройки'
  if (page === 'chat') {
    const c = chats.find((x) => x.id === activeChatId)
    title = c?.title || 'Чат'
  }

  const askFileAccess = ready && !settings.fileAccessPrompted && (!project || project.needsPermission)
  const finishAccessPrompt = () => setSettings((s) => ({ ...s, fileAccessPrompted: true }))
  const allowFileAccess = async () => {
    if (project?.needsPermission) await store.grantPermission()
    else await store.openFolder()
    finishAccessPrompt()
  }

  return (
    <div
      className={`app theme-${settings.theme || 'black'} font-${settings.fontScale || 100}` +
        (settings.reduceMotion ? ' reduce-motion' : '') +
        (settings.highContrast ? ' high-contrast' : '') +
        (canvasOpen && page === 'chat' ? ' canvas-active' : '')}
    >
      {!splashGone && <LoadingScreen hide={ready} />}

      {ready && !accessChosen && <AuthScreen onGuest={() => setAccessChosen(true)} onAuthenticated={() => setAccessChosen(true)} />}

      {ready && accessChosen && (
        <>
          <header className="topbar">
            <button className="iconbtn" onClick={() => store.setMenuOpen(true)} aria-label="Меню">
              <IconMenu />
            </button>
            <div className="topbar-title">{title}</div>
            {page === 'chat' && (
              <button className={'iconbtn' + (canvasOpen ? ' active' : '')} onClick={() => setCanvasOpen((v) => !v)} aria-label="Открыть Canvas">
                <IconEdit />
              </button>
            )}
          </header>

          <Sidebar />

          <div className={'workspace' + (canvasOpen && page === 'chat' ? ' canvas-open' : '')}>
            <main className="main">
              {page === 'chat' && <ChatPage />}
              {page === 'files' && <FilesPage />}
              {page === 'plugins' && <PluginsPage />}
              {page === 'memory' && <MemoryPage />}
              {page === 'tasks' && <TasksPage />}
              {page === 'media' && <MediaPage />}
              {page === 'settings' && <SettingsPage />}
            </main>
            <CanvasPanel open={canvasOpen && page === 'chat'} onClose={() => setCanvasOpen(false)} />
          </div>

          {askFileAccess && (
            <FileAccessPrompt
              needsGrant={!!project?.needsPermission}
              onAllow={allowFileAccess}
              onLater={finishAccessPrompt}
            />
          )}

          {toastMsg && <div className="toast">{toastMsg}</div>}

          {/* запасной выбор папки для браузеров без File System Access API */}
          <input
            ref={dirRef}
            type="file"
            hidden
            multiple
            {...({ webkitdirectory: '' } || {})}
            onChange={async (e) => {
              const fl = [...e.target.files]
              e.target.value = ''
              await store.openFolderVirtual(fl)
            }}
          />
        </>
      )}
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
