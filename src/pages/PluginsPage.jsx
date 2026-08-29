import React, { useState } from 'react'
import { useStore } from '../store'
import { uid } from '../lib/storage'
import {
  IconCode, IconPlus, IconPuzzle, IconShieldCheck, IconSparkles, IconTrash,
} from '../components/Icons'

const ICONS = {
  'project-guide': IconCode,
  'code-review': IconShieldCheck,
  'test-engineer': IconPuzzle,
  'ui-polish': IconSparkles,
}

const EMPTY_FORM = { name: '', description: '', instructions: '' }

export default function PluginsPage() {
  const { settings, setSettings, toast } = useStore()
  const plugins = settings.plugins || []
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const toggle = (id) => {
    setSettings((s) => ({
      ...s,
      plugins: (s.plugins || []).map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p),
    }))
  }

  const remove = (id) => {
    setSettings((s) => ({ ...s, plugins: (s.plugins || []).filter((p) => p.id !== id) }))
    toast('Навык удалён')
  }

  const add = () => {
    if (!form.name.trim() || !form.instructions.trim()) {
      toast('Укажите название и инструкцию для ИИ')
      return
    }
    const plugin = {
      id: 'custom-' + uid(),
      name: form.name.trim(),
      description: form.description.trim() || 'Пользовательский навык агента',
      instructions: form.instructions.trim(),
      enabled: true,
      builtIn: false,
    }
    setSettings((s) => ({ ...s, plugins: [...(s.plugins || []), plugin] }))
    setForm(EMPTY_FORM)
    setAdding(false)
    toast('Навык включён: ' + plugin.name)
  }

  const enabledCount = plugins.filter((p) => p.enabled).length

  return (
    <div className="page plugins-page">
      <div className="plugins-wrap">
        <section className="plugins-hero">
          <div className="plugins-hero-icon"><IconSparkles width={24} height={24} /></div>
          <div>
            <h1>Навыки агента</h1>
            <p>Наборы инструкций, которые настраивают подход агента к каждой задаче.</p>
          </div>
          <span className="plugins-count">{enabledCount} вкл.</span>
        </section>

        <div className="plugins-heading">
          <span>Доступные навыки</span>
          <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>
            <IconPlus width={14} height={14} /> Свой навык
          </button>
        </div>

        {adding && (
          <section className="plugin-form">
            <div className="form-title">Новый навык агента</div>
            <div className="form-sub">Создайте переиспользуемую инструкцию, которая будет добавляться в контекст модели.</div>
            <div className="field">
              <label>Название</label>
              <input className="input" placeholder="Например, Архитектор React" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Краткое описание</label>
              <input className="input" placeholder="Что делает этот навык" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="field">
              <label>Инструкция для ИИ</label>
              <textarea className="input ta" rows={5} placeholder="Как модель должна работать, что проверять и какой результат выдавать…"
                value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} />
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={add}>Создать и включить</button>
              <button className="btn" onClick={() => { setAdding(false); setForm(EMPTY_FORM) }}>Отмена</button>
            </div>
          </section>
        )}

        <div className="plugin-grid">
          {plugins.map((plugin) => {
            const PluginIcon = ICONS[plugin.id] || IconPuzzle
            return (
              <article className={'plugin-card' + (plugin.enabled ? ' enabled' : '')} key={plugin.id}>
                <div className="plugin-icon"><PluginIcon width={20} height={20} /></div>
                <div className="plugin-info">
                  <div className="plugin-title-row">
                    <b>{plugin.name}</b>
                    <span className="plugin-badge">{plugin.builtIn ? 'VerbaIDE' : 'Свой'}</span>
                  </div>
                  <p>{plugin.description}</p>
                </div>
                <button className={'switch' + (plugin.enabled ? ' on' : '')} role="switch"
                  aria-checked={plugin.enabled} aria-label={`${plugin.enabled ? 'Выключить' : 'Включить'} ${plugin.name}`}
                  onClick={() => toggle(plugin.id)}><span /></button>
                {!plugin.builtIn && (
                  <button className="plugin-delete" onClick={() => remove(plugin.id)} aria-label="Удалить навык">
                    <IconTrash width={14} height={14} />
                  </button>
                )}
              </article>
            )
          })}
        </div>

        <p className="plugins-footnote">
          Включённые навыки работают со всеми подключёнными провайдерами. Они не получают отдельный доступ к файлам или сети.
        </p>
      </div>
    </div>
  )
}
