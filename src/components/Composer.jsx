import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { inferProviderCapabilities } from '../lib/llm'
import { SLASH_COMMANDS } from '../lib/commands'
import {
  IconPlus, IconChevronDown, IconMic,
  IconArrowUp, IconStop, IconCheck, IconFolder, IconUpload, IconGear, IconFile, IconClose, IconCamera, IconStar, IconCode,
} from './Icons'

const EFFORTS = [
  ['low', 'Низкая'],
  ['medium', 'Средняя'],
  ['high', 'Высокая'],
]

export default function Composer({
  value, onChange, onSend, onStop, streaming,
  attachments, onRemoveAttachment, onToggleAttach, onAttachFiles,
  contextPercent = 0, contextTokens = 0,
}) {
  const store = useStore()
  const { settings, setSettings, project } = store
  const [plusOpen, setPlusOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [modelPopoverBottom, setModelPopoverBottom] = useState('70px')
  const [listening, setListening] = useState(false)
  const [typingHint, setTypingHint] = useState('')
  const taRef = useRef(null)
  const wrapRef = useRef(null)
  const modelAnchorRef = useRef(null)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const recRef = useRef(null)
  const baseRef = useRef('')

  // Живой placeholder: печатает фразу, затем циклично добавляет три точки.
  useEffect(() => {
    if (value) {
      setTypingHint('')
      return
    }
    const phrase = 'Поручите что угодно'
    const reduceMotion = settings.reduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setTypingHint(phrase + '…')
      return
    }
    let letter = 0
    let dots = 0
    let timer
    const typeLetter = () => {
      letter++
      setTypingHint(phrase.slice(0, letter))
      if (letter < phrase.length) timer = setTimeout(typeLetter, 52 + Math.random() * 34)
      else timer = setTimeout(typeDots, 420)
    }
    const typeDots = () => {
      dots = (dots + 1) % 4
      setTypingHint(phrase + '.'.repeat(dots))
      timer = setTimeout(typeDots, dots === 3 ? 820 : 310)
    }
    timer = setTimeout(typeLetter, 260)
    return () => clearTimeout(timer)
  }, [!!value, settings.reduceMotion])

  // голосовой ввод (Web Speech API)
  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      store.toast('Голосовой ввод не поддерживается этим браузером')
      return
    }
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new SR()
    rec.lang = navigator.language || 'ru-RU'
    rec.interimResults = true
    rec.continuous = false
    baseRef.current = value ? value + ' ' : ''
    rec.onresult = (e) => {
      let txt = ''
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript
      onChange(baseRef.current + txt)
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e) => {
      setListening(false)
      if (e.error !== 'aborted' && e.error !== 'no-speech') store.toast('Микрофон: ' + e.error)
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  // авторазмер textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.28) + 'px'
  }, [value])

  // Распознавание речи продолжало слушать микрофон после ухода из чата.
  useEffect(() => () => {
    try { recRef.current?.abort?.() } catch { /* уже остановлено */ }
  }, [])

  // закрытие попапов по клику мимо
  useEffect(() => {
    if (!plusOpen && !modelOpen) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) {
        setPlusOpen(false)
        setModelOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [plusOpen, modelOpen])

  // Окно моделей закреплено по краям экрана, а не по узкой кнопке. Нижнюю
  // границу вычисляем от реальной позиции кнопки, включая клавиатуру и вложения.
  useLayoutEffect(() => {
    if (!modelOpen) return undefined
    const place = () => {
      const rect = modelAnchorRef.current?.getBoundingClientRect()
      if (rect) setModelPopoverBottom(`${Math.max(10, window.innerHeight - rect.top + 10)}px`)
    }
    place()
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [modelOpen, attachments.length])

  const modelLabel = settings.selected?.model || 'Модель'
  const effortLabel = EFFORTS.find((e) => e[0] === settings.effort)?.[1]

  const selectModel = (providerId, model) => {
    store.selectModel(providerId, model)
    setModelOpen(false)
    setModelQuery('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      // на сенсорных экранах Enter — перенос строки, отправка кнопкой
      if (window.matchMedia('(pointer: coarse)').matches) return
      e.preventDefault()
      onSend()
    }
  }

  const projFiles = (project?.tree || []).filter((t) => t.kind === 'file').slice(0, 400)
  const provider = settings.providers.find((p) => p.id === settings.selected?.providerId)
  const selectedCaps = provider ? inferProviderCapabilities({ ...provider, models: [settings.selected?.model || ''] }) : null
  const visionDisabled = selectedCaps?.vision === false
  const mention = useMemo(() => value.match(/@([^\s@]*)$/), [value])
  const slash = useMemo(() => value.match(/^\/([a-z]*)$/i), [value])
  const mentionResults = useMemo(() => {
    if (!mention || !project) return []
    const query = mention[1].toLowerCase()
    return projFiles.filter((x) => x.path.toLowerCase().includes(query)).slice(0, 7)
  }, [mention, project, projFiles.map((x) => x.path).join('|')])

  const insertMention = (path) => {
    if (!mention) return
    onChange(value.slice(0, mention.index) + '@' + path + ' ')
    requestAnimationFrame(() => taRef.current?.focus())
  }

  const insertCommand = (id) => {
    onChange('/' + id + ' ')
    requestAnimationFrame(() => taRef.current?.focus())
  }

  const favorites = settings.favoriteModels || []
  const isFavorite = (providerId, model) => favorites.includes(`${providerId}:${model}`)
  const toggleFavorite = (providerId, model) => {
    const key = `${providerId}:${model}`
    setSettings((s) => ({
      ...s,
      favoriteModels: (s.favoriteModels || []).includes(key)
        ? s.favoriteModels.filter((x) => x !== key)
        : [...(s.favoriteModels || []), key],
    }))
  }
  const favoriteOptions = favorites.map((key) => {
    const split = key.indexOf(':')
    const providerId = key.slice(0, split)
    const model = key.slice(split + 1)
    const p = settings.providers.find((item) => item.id === providerId && item.models.includes(model))
    return p ? { provider: p, model } : null
  }).filter(Boolean)
  const normalizedModelQuery = modelQuery.trim().toLowerCase()
  const visibleProviders = settings.providers.map((p) => ({
    ...p,
    filteredModels: normalizedModelQuery ? p.models.filter((m) => m.toLowerCase().includes(normalizedModelQuery)) : p.models,
  })).filter((p) => p.filteredModels.length)

  const modelOption = (p, model, favoriteSection = false) => {
    const sel = settings.selected?.providerId === p.id && settings.selected?.model === model
    const fav = isFavorite(p.id, model)
    return (
      <div className="model-option-row" key={(favoriteSection ? 'fav:' : '') + p.id + ':' + model}>
        <button className="pop-item model-option-main" onClick={() => selectModel(p.id, model)}>
          <span className="pop-label">{model}</span>
          {favoriteSection && <small>{p.name}</small>}
          {sel && <IconCheck className="pop-check" width={14} height={14} />}
        </button>
        <button className={'model-star' + (fav ? ' on' : '')} onClick={() => toggleFavorite(p.id, model)} aria-label={fav ? 'Убрать из избранного' : 'Добавить в избранное'}>
          <IconStar filled={fav} width={14} height={14} />
        </button>
      </div>
    )
  }

  const pasteFiles = (e) => {
    const files = [...(e.clipboardData?.files || [])]
    if (!files.length) return
    e.preventDefault()
    onAttachFiles(files)
  }

  const closePops = () => {
    setPlusOpen(false)
    setModelOpen(false)
  }

  return (
    <div className="composer-wrap" ref={wrapRef}>
      {/* Попап моделей занимает почти пол-экрана, поэтому тап «по чату» часто
          попадал в сам попап и ничего не закрывал — ловим его подложкой. */}
      {(plusOpen || modelOpen) && (
        <div className="pop-backdrop" onPointerDown={closePops} aria-hidden="true" />
      )}
      <div className="composer">
        {attachments.length > 0 && (
          <div className="comp-atts">
            {attachments.map((a) => (
              <span key={a.path} className="att-chip" title={a.path}>
                {a.kind === 'image' && a.dataUrl
                  ? <img className="att-thumb" src={a.dataUrl} alt="" />
                  : <IconFile width={12} height={12} />}
                <span>{a.path.split('/').pop()}</span>
                <button className="chip-x" onClick={() => onRemoveAttachment(a.path)} aria-label="Убрать">
                  <IconClose width={11} height={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="comp-input-wrap">
          {!value && <span className="typing-placeholder" aria-hidden="true">{typingHint}</span>}
          <textarea
            ref={taRef}
            className="comp-input"
            rows={1}
            aria-label="Сообщение"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={pasteFiles}
          />
        </div>

        {mentionResults.length > 0 && !modelOpen && !plusOpen && (
          <div className="mention-pop">
            <div className="pop-head">Указать файл</div>
            {mentionResults.map((file) => (
              <button key={file.path} className="pop-item" onClick={() => insertMention(file.path)}>
                <IconFile width={14} height={14} /><span className="pop-label">{file.path}</span>
              </button>
            ))}
          </div>
        )}

        {slash && !modelOpen && !plusOpen && (
          <div className="mention-pop command-pop">
            <div className="pop-head">Команды</div>
            {SLASH_COMMANDS.filter((command) => command.id.startsWith(slash[1].toLowerCase())).map((command) => (
              <button key={command.id} className="pop-item command-item" onClick={() => insertCommand(command.id)}>
                <span className="command-icon"><IconCode width={14} height={14} /></span>
                <span className="pop-label"><b>/{command.id}</b><small>{command.hint}</small></span>
              </button>
            ))}
          </div>
        )}

        <div className="context-line" title={`Примерно ${contextTokens.toLocaleString('ru-RU')} токенов`}>
          <span>Контекст {contextTokens > 0 && contextPercent === 0 ? '<1' : contextPercent}%</span><i><b style={{ width: `${Math.max(contextTokens ? 1 : 0, contextPercent)}%` }} /></i>
        </div>

        <div className="comp-row">
          <div className="pop-anchor">
            <button
              className="round-btn"
              aria-label="Прикрепить"
              onClick={() => { setPlusOpen((v) => !v); setModelOpen(false) }}
            >
              <IconPlus />
            </button>


            {plusOpen && (
              <div className="pop pop-left">
                <div className="pop-head">Проект</div>
                <button className="pop-item" onClick={() => { setPlusOpen(false); store.openFolder() }}>
                  <IconFolder width={15} height={15} />
                  <span className="pop-label">{project ? 'Открыть другую папку' : 'Открыть папку проекта'}</span>
                </button>
                <button className="pop-item" onClick={() => fileInputRef.current?.click()}>
                  <IconUpload width={15} height={15} />
                  <span className="pop-label">Загрузить файлы с устройства</span>
                </button>
                <button className="pop-item" disabled={visionDisabled} title={visionDisabled ? 'Выбранный провайдер не поддерживает Vision' : ''} onClick={() => cameraInputRef.current?.click()}>
                  <IconCamera width={15} height={15} />
                  <span className="pop-label">Сделать фото</span>
                </button>
                {visionDisabled && <div className="pop-note">Камера недоступна: Vision не найден у выбранной модели.</div>}

                {projFiles.length > 0 && (
                  <>
                    <div className="pop-head">Прикрепить файлы</div>
                    <div className="pop-list">
                      {projFiles.map((t) => {
                        const checked = attachments.some((a) => a.path === t.path)
                        return (
                          <button key={t.path} className="pop-item" onClick={() => onToggleAttach(t.path)}>
                            <IconFile width={14} height={14} />
                            <span className="pop-label">{t.path}</span>
                            {checked && <IconCheck className="pop-check" width={14} height={14} />}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
                {!project && (
                  <div className="pop-note">Откройте папку проекта, чтобы прикреплять её файлы к запросу.</div>
                )}
              </div>
            )}
          </div>

          <div className="pop-anchor grow-anchor" ref={modelAnchorRef}>
            <button
              className="model-btn"
              onClick={() => { setModelOpen((v) => !v); setPlusOpen(false) }}
            >
              <b>{modelLabel}</b>
              <span>{effortLabel}</span>
              <IconChevronDown width={13} height={13} />
            </button>

            {modelOpen && (
              <div className="pop pop-right model-pop" style={{ bottom: modelPopoverBottom }}>
                <div className="pop-head">Старательность</div>
                <div className="seg">
                  {EFFORTS.map(([v, l]) => (
                    <button
                      key={v}
                      className={settings.effort === v ? 'on' : ''}
                      onClick={() => setSettings((s) => ({ ...s, effort: v }))}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {project && (
                  <div className="pop-note">Выбор запомнится для проекта «{project.name}».</div>
                )}

                {settings.providers.length === 0 ? (
                  <button
                    className="pop-item"
                    onClick={() => { setModelOpen(false); store.setPage('settings') }}
                  >
                    <IconGear width={15} height={15} />
                    <span className="pop-label">Настроить провайдера</span>
                  </button>
                ) : (
                  <div className="model-options">
                    <div className="model-search-wrap">
                      <input autoFocus className="model-search" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder="Поиск моделей…" aria-label="Поиск моделей" />
                    </div>
                    {!normalizedModelQuery && favoriteOptions.length > 0 && (
                      <>
                        <div className="pop-group fav-group"><IconStar filled width={11} height={11} /> Избранное</div>
                        {favoriteOptions.map(({ provider: p, model }) => modelOption(p, model, true))}
                      </>
                    )}
                    {visibleProviders.map((p) => (
                      <React.Fragment key={p.id}>
                        <div className="pop-group">{p.name}</div>
                        {p.filteredModels.map((m) => modelOption(p, m))}
                      </React.Fragment>
                    ))}
                    {visibleProviders.length === 0 && <div className="pop-note">Ничего не найдено</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            className={'round-btn mic' + (listening ? ' listening' : '')}
            onClick={toggleMic}
            aria-label="Голосовой ввод"
            title={listening ? 'Остановить запись' : 'Голосовой ввод'}
          >
            <IconMic />
          </button>

          {streaming ? (
            <button className="send-btn stop" onClick={onStop} aria-label="Остановить">
              <IconStop width={14} height={14} />
            </button>
          ) : (
            <button className="send-btn idle" onClick={onSend} aria-label="Отправить">
              <IconArrowUp width={16} height={16} />
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.apk,.pdf,.docx,.xlsx,.xls,.ods,.csv,.tsv,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css"
        hidden
        onChange={(e) => {
          const fl = [...e.target.files]
          e.target.value = ''
          onAttachFiles(fl)
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const fl = [...e.target.files]
          e.target.value = ''
          onAttachFiles(fl)
          setPlusOpen(false)
        }}
      />
    </div>
  )
}
