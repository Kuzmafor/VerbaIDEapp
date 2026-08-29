import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getProfile, Avatar } from '../lib/profile.jsx'
import { supabase } from '../lib/supabase'
import { IconClose, IconChat, IconFolder, IconGear, IconPlus, IconPuzzle, IconTrash, IconBrain, IconTasks, IconCamera } from './Icons'

export default function Sidebar() {
  const store = useStore()
  const { chats, activeChatId, page, menuOpen, projects, project } = store
  const history = chats.filter((c) => c.messages.length > 0)
  const { uid } = getProfile()
  const [account, setAccount] = useState(null)

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    supabase.auth.getUser().then(({ data }) => { if (active) setAccount(data.user || null) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAccount(session?.user || null)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const meta = account?.user_metadata || {}
  const telegramName = meta.telegram_username ? '@' + meta.telegram_username : (meta.full_name || account?.email || uid)
  const accountKind = meta.provider === 'telegram' ? 'Вход через Telegram' : account ? 'Аккаунт VerbaIDE' : 'Локальный профиль'

  const go = (p) => {
    store.setPage(p)
    store.setMenuOpen(false)
  }

  return (
    <>
      <div className={'backdrop' + (menuOpen ? ' show' : '')} onClick={() => store.setMenuOpen(false)} />
      <aside className={'sidebar' + (menuOpen ? ' open' : '')}>
        <div className="side-head">
          <span className="side-logo">VerbaIDE</span>
          <button className="iconbtn" onClick={() => store.setMenuOpen(false)} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>

        <button className="newchat-btn" onClick={store.newChat}>
          <IconPlus width={16} height={16} /> Новый чат
        </button>

        <div className="side-scroll">
          <nav className="side-nav">
            <button className={page === 'chat' ? 'active' : ''} onClick={() => go('chat')}>
              <IconChat width={17} height={17} /> Чат
            </button>
            <button className={page === 'files' ? 'active' : ''} onClick={() => go('files')}>
              <IconFolder width={17} height={17} /> Файлы
            </button>
            <button className={page === 'plugins' ? 'active' : ''} onClick={() => go('plugins')}>
              <IconPuzzle width={17} height={17} /> Навыки
            </button>
            <button className={page === 'memory' ? 'active' : ''} onClick={() => go('memory')}>
              <IconBrain width={17} height={17} /> Память
            </button>
            <button className={page === 'tasks' ? 'active' : ''} onClick={() => go('tasks')}>
              <IconTasks width={17} height={17} /> Задачи {store.tasks?.filter((t) => ['running', 'queued'].includes(t.status)).length ? <i className="nav-count">{store.tasks.filter((t) => ['running', 'queued'].includes(t.status)).length}</i> : null}
            </button>
            <button className={page === 'media' ? 'active' : ''} onClick={() => go('media')}><IconCamera width={17} height={17} /> Медиа</button>
            <button className={page === 'settings' ? 'active' : ''} onClick={() => go('settings')}>
              <IconGear width={17} height={17} /> Настройки
            </button>
          </nav>

          <div className="side-sect">Проекты</div>
          <div className="side-list">
            {projects.length === 0 && <div className="side-empty">Нет проектов</div>}
            {projects.map((p) => (
              <div
                key={p.id}
                className={'side-chat' + (project?.id === p.id ? ' active' : '')}
                onClick={() => store.switchProject(p.id)}
                title="Открыть проект"
              >
                <IconFolder width={14} height={14} />
                <span className="side-chat-title">{p.name}</span>
                {p.type === 'handle' && <span className="badge">диск</span>}
                <button
                  className="side-chat-del"
                  onClick={(e) => {
                    e.stopPropagation()
                    store.deleteProject(p.id)
                  }}
                  aria-label="Удалить проект"
                >
                  <IconTrash width={13} height={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="side-sect">Сохранённые чаты</div>
          <div className="side-list">
            {history.length === 0 && <div className="side-empty">Пока пусто</div>}
            {history.map((c) => (
              <div
                key={c.id}
                className={'side-chat' + (c.id === activeChatId ? ' active' : '')}
                onClick={() => {
                  store.setActiveChatId(c.id)
                  go('chat')
                }}
              >
                <IconChat width={14} height={14} />
                <span className="side-chat-title">{c.title}</span>
                <button
                  className="side-chat-del"
                  onClick={(e) => {
                    e.stopPropagation()
                    store.deleteChat(c.id)
                  }}
                  aria-label="Удалить чат"
                >
                  <IconTrash width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div
          className="side-foot profile"
          onClick={() => {
            store.setPage('settings')
            store.setMenuOpen(false)
          }}
          title="Профиль и настройки"
        >
          {meta.avatar_url
            ? <img className="side-profile-avatar" src={meta.avatar_url} alt="" referrerPolicy="no-referrer" />
            : <Avatar size={32} />}
          <span className="side-uid-col">
            <span className="side-uid">{telegramName}</span>
            <span className="side-uid-sub">{accountKind}</span>
          </span>
          <IconGear width={15} height={15} className="side-uid-gear" />
        </div>
      </aside>
    </>
  )
}
