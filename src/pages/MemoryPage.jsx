import React, { useState } from 'react'
import { useStore } from '../store'
import { uid } from '../lib/storage'
import { IconBrain, IconTrash } from '../components/Icons'

export default function MemoryPage() {
  const store = useStore()
  const { settings, setSettings, project } = store
  const [text, setText] = useState('')
  const [scope, setScope] = useState(project ? 'project' : 'global')
  const memories = settings.memories || []
  const projectInstruction = project ? (settings.projectInstructions?.[project.id] || '') : ''

  const add = () => {
    const value = text.trim()
    if (!value) return
    const entry = { id: uid(), text: value.slice(0, 3000), scope, projectId: scope === 'project' ? project?.id : null, createdAt: Date.now() }
    setSettings((s) => ({ ...s, memories: [...(s.memories || []), entry] }))
    setText('')
    store.toast('Добавлено в память')
  }

  return (
    <div className="page memory-page">
      <div className="memory-wrap">
        <div className="memory-hero">
          <span><IconBrain /></span>
          <div><h1>Память</h1><p>Факты, предпочтения и контекст, которые модель использует в следующих запросах.</p></div>
        </div>

        {project && (
          <section className="memory-card">
            <h3>Инструкции проекта · {project.name}</h3>
            <textarea
              className="input ta"
              value={projectInstruction}
              onChange={(e) => setSettings((s) => ({
                ...s,
                projectInstructions: { ...(s.projectInstructions || {}), [project.id]: e.target.value },
              }))}
              placeholder="Например: используем TypeScript strict, интерфейс — только на русском…"
            />
            <small>Эти инструкции применяются только к текущему проекту.</small>
          </section>
        )}

        <section className="memory-card">
          <h3>Запомнить новое</h3>
          <textarea className="input ta" value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: предпочитаю короткие ответы и функциональные компоненты" />
          <div className="memory-add-row">
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="global">Глобально</option>
              {project && <option value="project">Только проект</option>}
            </select>
            <button className="btn btn-primary btn-sm" onClick={add}>Запомнить</button>
          </div>
        </section>

        <label className="check-row">
          <input type="checkbox" checked={settings.autoSummarize !== false} onChange={(e) => setSettings((s) => ({ ...s, autoSummarize: e.target.checked }))} />
          <span><b>Автоматическое резюме длинных чатов</b><small>Сжимает старую часть диалога, сохраняя решения и важные детали.</small></span>
        </label>

        <div className="memory-heading">Сохранённые записи · {memories.length}</div>
        {!memories.length && <div className="memory-empty">Память пока пуста. Нажмите «Запомнить» под сообщением или добавьте запись выше.</div>}
        {memories.map((memory) => (
          <div className="memory-entry" key={memory.id}>
            <div><span>{memory.scope === 'project' ? 'Проект' : 'Глобально'}</span><p>{memory.text}</p></div>
            <button className="iconbtn small danger" onClick={() => setSettings((s) => ({ ...s, memories: (s.memories || []).filter((x) => x.id !== memory.id) }))} aria-label="Удалить"><IconTrash /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
