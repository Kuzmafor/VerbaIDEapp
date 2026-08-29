import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconShieldCheck } from '../components/Icons'

const functionUrl = () => `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/admin-users`

export default function AdminPage() {
  const [state, setState] = useState('loading')
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState('')

  const request = useCallback(async (method = 'GET', body) => {
    if (!supabase) throw new Error('Supabase не настроен в приложении.')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Войдите в аккаунт, чтобы открыть панель.')
    const response = await fetch(functionUrl(), {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'Сервер не выполнил запрос.')
    return data
  }, [])

  const load = useCallback(async () => {
    setState('loading'); setError('')
    try {
      const data = await request()
      setUsers(data.users || [])
      setState('ready')
    } catch (cause) {
      setError(cause.message || 'Не удалось открыть панель.')
      setState('error')
    }
  }, [request])

  useEffect(() => { load() }, [load])

  const toggleBlock = async (user) => {
    setUpdating(user.id); setError('')
    try {
      await request('PATCH', { userId: user.id, isBlocked: !user.isBlocked })
      setUsers((items) => items.map((item) => item.id === user.id ? { ...item, isBlocked: !item.isBlocked } : item))
    } catch (cause) { setError(cause.message || 'Не удалось изменить доступ.') }
    finally { setUpdating('') }
  }

  if (state === 'loading') return <div className="page admin-page"><div className="empty-state">Загрузка панели администратора…</div></div>
  if (state === 'error') return <div className="page admin-page"><section className="admin-locked"><IconShieldCheck width={28} height={28} /><h2>Доступ ограничен</h2><p>{error}</p><button className="mini-btn" onClick={load}>Повторить</button><small>Панель станет доступна после применения миграции и назначения роли admin.</small></section></div>

  const blocked = users.filter((user) => user.isBlocked).length
  return <div className="page admin-page">
    <section className="admin-hero">
      <div><span className="eyebrow">VERBAIDE CONTROL</span><h1>Панель администратора</h1><p>Управляйте доступом к аккаунтам и следите за регистрациями.</p></div>
      <button className="mini-btn" onClick={load}>Обновить</button>
    </section>
    <section className="admin-stats"><div><b>{users.length}</b><span>аккаунтов</span></div><div><b>{users.filter((user) => user.lastSignInAt).length}</b><span>входили в систему</span></div><div><b>{blocked}</b><span>ограничены</span></div></section>
    {error && <p className="admin-error">{error}</p>}
    <section className="admin-users"><div className="admin-users-title"><h2>Пользователи</h2><span>{users.length}</span></div>
      {users.length === 0 ? <div className="empty-state">Аккаунтов пока нет.</div> : users.map((user) => <article className="admin-user" key={user.id}>
        <div className="admin-avatar">{(user.name || user.email || '?').trim().slice(0, 1).toUpperCase()}</div>
        <div className="admin-user-copy"><b>{user.name || 'Без имени'}</b><span>{user.email || user.id}</span><small>{user.provider || 'email'} · зарегистрирован {new Date(user.createdAt).toLocaleDateString('ru-RU')}</small></div>
        <button className={'mini-btn ' + (user.isBlocked ? 'admin-allow' : 'admin-block')} disabled={updating === user.id} onClick={() => toggleBlock(user)}>{user.isBlocked ? 'Разблокировать' : 'Ограничить'}</button>
      </article>)}</section>
  </div>
}
