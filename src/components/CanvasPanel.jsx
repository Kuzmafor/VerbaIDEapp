import React, { useEffect, useMemo, useRef, useState } from 'react'
import CodeEditor from './CodeEditor'
import { useStore } from '../store'
import { streamChat } from '../lib/llm'
import { isBinaryPath } from '../lib/fs'
import { mimeForPath, saveTextFile } from '../lib/deviceSave'
import { IconCheck, IconClose, IconDownload, IconSparkles, IconUndo } from './Icons'

function stripFence(value) {
  let text = String(value || '').trim()
  text = text.replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, '')
  return text
}

function lineDiff(before, after) {
  const a = String(before).split('\n')
  const b = String(after).split('\n')
  if (a.length * b.length > 90000) {
    return [
      ...a.map((text, i) => ({ type: 'remove', text, oldLine: i + 1 })),
      ...b.map((text, i) => ({ type: 'add', text, newLine: i + 1 })),
    ]
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 }); i++; j++
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      rows.push({ type: 'add', text: b[j], newLine: j + 1 }); j++
    } else {
      rows.push({ type: 'remove', text: a[i], oldLine: i + 1 }); i++
    }
  }
  return rows
}

export default function CanvasPanel({ open, onClose }) {
  const store = useStore()
  const { project, settings } = store
  const files = useMemo(
    () => (project?.tree || []).filter((x) => x.kind === 'file' && !isBinaryPath(x.path)).map((x) => x.path),
    [project]
  )
  const [path, setPath] = useState('')
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState({ from: 0, to: 0, text: '' })
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)

  useEffect(() => {
    store.setCanvasSelection(selection.text ? { path, ...selection } : null)
    return () => store.setCanvasSelection(null)
  }, [path, selection.from, selection.to, selection.text])

  useEffect(() => {
    if (!open) return
    setPath((current) => files.includes(current) ? current : (files[0] || ''))
  }, [open, project?.id, files.join('|')])

  useEffect(() => {
    if (!open || !path || !project) return
    let live = true
    ;(async () => {
      try {
        const text = await store.readFile(path)
        if (!live) return
        setOriginal(text)
        setDraft(text)
        setProposal(null)
        setSelection({ from: 0, to: 0, text: '' })
      } catch (e) {
        store.toast(e.message)
      }
    })()
    return () => { live = false }
  }, [open, path, project?.id])

  const requestEdit = async () => {
    const provider = store.selectedProvider()
    const model = settings.selected?.model
    if (!provider || !model) return store.toast('Сначала добавьте провайдера в Настройках')
    if (!instruction.trim()) return store.toast('Опишите, что нужно изменить')
    setBusy(true)
    setProposal('')
    abortRef.current = new AbortController()
    const selectedPart = selection.text
      ? `\nВыделенный пользователем фрагмент (${selection.from}-${selection.to}):\n${selection.text}\n`
      : ''
    const prompt = `Измени файл ${path || 'document.txt'} по инструкции пользователя.\n` +
      `Инструкция: ${instruction.trim()}\n${selectedPart}\n` +
      `Верни ТОЛЬКО полный итоговый текст файла, без Markdown-ограждения и объяснений.\n\nТекущий файл:\n${draft}`
    try {
      let text = ''
      const iterator = streamChat({
        provider, model,
        messages: [{ role: 'user', content: prompt }],
        system: 'Ты точный редактор кода и документов. Сохраняй всё, что не просили менять.',
        signal: abortRef.current.signal,
        thinking: false,
        tools: [],
      })
      for await (const event of iterator) {
        if (event.kind === 'text') {
          text += event.value
          setProposal(stripFence(text))
        }
      }
      setProposal(stripFence(text))
    } catch (e) {
      if (e.name !== 'AbortError') store.toast(e.message)
      else setProposal(null)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const saveDraft = async () => {
    if (!path) return store.toast('Выберите файл')
    try {
      await store.writeFile(path, draft)
      await store.refreshTree()
      setOriginal(draft)
      store.toast('Файл сохранён')
    } catch (e) { store.toast(e.message) }
  }

  const applyProposal = async () => {
    if (proposal == null) return
    try {
      await store.writeFile(path, proposal)
      await store.refreshTree()
      setDraft(proposal)
      setOriginal(proposal)
      setProposal(null)
      setInstruction('')
      store.toast('Изменения применены')
    } catch (e) { store.toast(e.message) }
  }

  const undo = () => {
    if (busy) abortRef.current?.abort()
    if (proposal != null) setProposal(null)
    else setDraft(original)
    store.toast('Изменения отменены')
  }

  const download = async () => {
    try {
      await saveTextFile({
        name: (path || 'document.txt').split('/').pop(),
        content: proposal ?? draft,
        mime: mimeForPath(path),
      })
      store.toast('Файл сохранён на устройство')
    } catch (e) {
      store.toast(e.message || 'Не удалось сохранить файл')
    }
  }

  const diff = useMemo(() => proposal == null ? [] : lineDiff(draft, proposal), [draft, proposal])
  if (!open) return null

  return (
    <aside className="canvas-panel" aria-label="Canvas">
      <div className="canvas-head">
        <div className="canvas-title"><IconSparkles /> <b>Canvas</b></div>
        <button className="iconbtn small" onClick={onClose} aria-label="Закрыть Canvas"><IconClose /></button>
      </div>

      {!project ? (
        <div className="canvas-empty">
          <b>Откройте проект</b>
          <span>Canvas редактирует файлы проекта рядом с чатом.</span>
          <button className="btn btn-primary btn-sm" onClick={store.openFolder}>Открыть папку</button>
        </div>
      ) : (
        <>
          <div className="canvas-filebar">
            <select className="input" value={path} onChange={(e) => setPath(e.target.value)}>
              {!files.length && <option value="">Нет текстовых файлов</option>}
              {files.map((file) => <option key={file} value={file}>{file}</option>)}
            </select>
            <button className="btn btn-sm" onClick={saveDraft} disabled={!path || draft === original}>Сохранить</button>
          </div>

          {proposal == null ? (
            <CodeEditor
              className="canvas-editor"
              path={path}
              value={draft}
              onChange={setDraft}
              onSave={saveDraft}
              onSelectionChange={setSelection}
            />
          ) : (
            <div className="canvas-diff" aria-label="Предпросмотр изменений">
              <div className="canvas-diff-head">Предпросмотр · <span>+{diff.filter(x => x.type === 'add').length}</span> / <em>−{diff.filter(x => x.type === 'remove').length}</em></div>
              <div className="diff-lines">
                {diff.map((row, i) => (
                  <div className={'diff-line ' + row.type} key={i}>
                    <span>{row.oldLine || ''}</span><span>{row.newLine || ''}</span><code>{row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '} {row.text || ' '}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="canvas-prompt">
            {!!selection.text && <div className="canvas-selection">Выделено: {selection.text.length} симв.</div>}
            <textarea
              className="input ta"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={selection.text ? 'Что изменить в выделенном фрагменте?' : 'Что изменить в файле?'}
            />
            <div className="canvas-actions">
              {proposal != null ? (
                <>
                  <button className="btn btn-sm" onClick={undo}><IconUndo /> Отменить</button>
                  <button className="btn btn-primary btn-sm" onClick={applyProposal} disabled={busy || !proposal}><IconCheck /> Применить</button>
                </>
              ) : (
                <>
                  {draft !== original && <button className="btn btn-sm" onClick={undo}><IconUndo /> Отменить</button>}
                  <button className="btn btn-primary btn-sm" onClick={requestEdit} disabled={busy || !path}>
                    <IconSparkles /> {busy ? 'Модель работает…' : 'Предложить правку'}
                  </button>
                </>
              )}
              <button className="btn btn-sm" onClick={download}><IconDownload /> Скачать</button>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
