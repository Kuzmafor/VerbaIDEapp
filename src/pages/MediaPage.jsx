import React, { useState } from 'react'
import { useStore } from '../store'
import { inferProviderCapabilities } from '../lib/llm'
import { generateImage } from '../lib/mediaGeneration'
import { IconCamera, IconSparkles } from '../components/Icons'

export default function MediaPage() {
  const store = useStore(); const [prompt, setPrompt] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState(null)
  const provider = store.selectedProvider(); const caps = provider ? inferProviderCapabilities({ ...provider, models: [store.settings.selected?.model || ''] }) : {}
  async function generate() { if (!provider || !prompt.trim() || busy) return; setBusy(true); setResult(null); try { setResult(await generateImage(provider, { prompt, model: store.settings.selected?.model || 'gpt-image-1' })) } catch (e) { store.toast('Генерация: ' + e.message) } finally { setBusy(false) } }
  return <div className="page media-page"><div className="page-hero"><span className="hero-icon"><IconCamera/></span><div><h2>Медиа-студия</h2><p>Доступны только функции выбранной модели.</p></div></div>{!provider ? <div className="pc-empty">Выберите провайдера и модель в чате.</div> : <><div className="cap-grid"><span className={'cap-chip ' + (caps.imageGeneration ? 'yes' : 'no')}>{caps.imageGeneration ? '✓' : '—'} Изображения</span><span className={'cap-chip ' + (caps.videoGeneration ? 'yes' : 'no')}>{caps.videoGeneration ? '✓' : '—'} Видео</span></div>{caps.imageGeneration ? <section className="form-card"><b>Создать изображение</b><textarea className="input media-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Опишите изображение…"/><button className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={generate}><IconSparkles width={15}/>{busy ? 'Генерирую…' : 'Сгенерировать'}</button>{result?.url && <img className="media-result" src={result.url} alt="Сгенерированный результат"/>}</section> : <div className="pc-empty">Выбранный endpoint не сообщил о поддержке генерации изображений.</div>}{caps.videoGeneration && <p className="hero-dim">Видео поддерживается моделью: добавим конкретный workflow после проверки API этого провайдера, поскольку форматы очереди и получения результата различаются.</p>}</>}</div>
}
