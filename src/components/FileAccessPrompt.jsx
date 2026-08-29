import React, { useState } from 'react'
import { IconCheck, IconFolder, IconShieldCheck } from './Icons'

export default function FileAccessPrompt({ needsGrant, onAllow, onLater }) {
  const [working, setWorking] = useState(false)
  const allow = async () => {
    setWorking(true)
    try {
      await onAllow()
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="access-backdrop" role="presentation">
      <section className="access-card" role="dialog" aria-modal="true" aria-labelledby="access-title">
        <div className="access-icon"><IconFolder width={27} height={27} /></div>
        <h2 id="access-title">Доступ к файлам проекта</h2>
        <p>
          VerbaIDE работает только с выбранной вами папкой. Остальные файлы устройства приложение не увидит.
        </p>
        <div className="access-list">
          <span><IconCheck width={14} height={14} /> Читать структуру и код проекта</span>
          <span><IconCheck width={14} height={14} /> Сохранять подтверждённые изменения</span>
          <span><IconShieldCheck width={14} height={14} /> Доступ можно отозвать в любой момент</span>
        </div>
        <button className="btn btn-primary access-allow" onClick={allow} disabled={working}>
          <IconFolder width={16} height={16} />
          {working ? 'Открываю выбор папки…' : needsGrant ? 'Разрешить доступ' : 'Выбрать папку проекта'}
        </button>
        <button className="access-later" onClick={onLater} disabled={working}>Продолжить без папки</button>
      </section>
    </div>
  )
}
