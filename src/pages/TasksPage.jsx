import React from 'react'
import { useStore } from '../store'
import { IconTasks, IconStop, IconTrash } from '../components/Icons'

export default function TasksPage() {
  const store = useStore()
  const active = store.tasks.filter((t) => !['done', 'cancelled'].includes(t.status))
  const done = store.tasks.filter((t) => ['done', 'failed', 'cancelled'].includes(t.status)).slice(-12).reverse()
  const go = (task) => { if (task.chatId) { store.setActiveChatId(task.chatId); store.setPage('chat') } }
  const row = (task) => <article className="task-card" key={task.id} onClick={() => go(task)}>
    <div><b>{task.title}</b><small>{task.step || 'Ожидание'}</small></div>
    <span className={'task-state ' + task.status}>{task.status === 'running' ? 'в работе' : task.status === 'queued' ? 'очередь' : task.status === 'paused' ? 'пауза' : task.status === 'done' ? 'готово' : 'ошибка'}</span>
    {task.tokens != null && <em>≈ {task.tokens.toLocaleString('ru-RU')} ток.</em>}
    {(task.status === 'queued' || task.status === 'paused') && <button className="iconbtn small" onClick={(e) => { e.stopPropagation(); store.patchTask(task.id, { status: 'cancelled', step: 'Отменена' }) }} aria-label="Отменить"><IconStop width={14}/></button>}
    {['done', 'failed', 'cancelled'].includes(task.status) && <button className="iconbtn small" onClick={(e) => { e.stopPropagation(); store.removeTask(task.id) }} aria-label="Удалить"><IconTrash width={14}/></button>}
  </article>
  return <div className="page tasks-page">
    <div className="page-hero"><span className="hero-icon"><IconTasks /></span><div><h2>Фоновый агент</h2><p>Ответ продолжает готовиться, пока вы смотрите файлы или другой чат.</p></div></div>
    <section><div className="sect-title">Активные задачи <span>{active.length}</span></div>{active.length ? active.map(row) : <div className="pc-empty">Нет активных задач</div>}</section>
    <section><div className="sect-title">История</div>{done.length ? done.map(row) : <div className="pc-empty">Завершённые задачи появятся здесь</div>}</section>
    <section className="limits-card"><b>Лимиты агента</b><p>Время: {store.settings.agentLimits?.maxMinutes || 12} мин · ответ: {Number(store.settings.agentLimits?.maxTokens || 24000).toLocaleString('ru-RU')} токенов.</p><button className="mini-btn" onClick={() => store.setPage('settings')}>Настроить лимиты и уведомления</button></section>
  </div>
}
