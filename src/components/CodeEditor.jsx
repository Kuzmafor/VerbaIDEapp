import React, { useEffect, useMemo, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { HighlightStyle, syntaxHighlighting, indentRange, syntaxTree } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'

function langFor(path = '') {
  let p = String(path).toLowerCase().trim()
  if (!p) return []
  if (!p.includes('.')) p = '.' + p.replace(/^file:/, '')
  if (/\.jsx$/.test(p)) return [javascript({ jsx: true })]
  if (/\.(tsx|ts)$/.test(p)) return [javascript({ typescript: true, jsx: /\.tsx$/.test(p) })]
  if (/\.(mjs|cjs|js)$/.test(p)) return [javascript()]
  if (/\.(html?|vue|xml|svg)$/.test(p)) return [html()]
  if (/\.(css|scss|less)$/.test(p)) return [css()]
  if (/\.json$/.test(p)) return [json()]
  if (/\.py$/.test(p)) return [python()]
  return []
}

// компактная тёмная палитра для кода в чате (без фона и номеров строк)
const chatHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.controlKeyword, color: '#c792ea' },
  { tag: t.string, color: '#9ece8f' },
  { tag: [t.number, t.bool, t.null], color: '#f7bd7f' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6a6a72', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.definition(t.variableName), t.className, t.typeName], color: '#ffd479' },
  { tag: t.propertyName, color: '#9db8ff' },
  { tag: t.operator, color: '#89ddff' },
  { tag: t.variableName, color: '#d6d6dc' },
  { tag: t.punctuation, color: '#8b8b92' },
  { tag: t.meta, color: '#8b8b92' },
])

const readableTheme = EditorView.theme({
  '&': { background: 'transparent', color: '#d6d6dc', fontSize: '12.5px' },
  '.cm-content': { padding: '10px 12px', fontFamily: 'var(--mono)', lineHeight: '1.5' },
  '&.cm-editor.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-scroller': { overflow: 'auto' },
})

const editorTheme = EditorView.theme({
  '&': { background: '#000', color: '#dcdce2', fontSize: '13px', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-gutters': { background: '#000', borderRight: '1px solid #1c1c22', color: '#4a4a52' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-activeLineGutter': { background: 'rgba(255,255,255,0.04)' },
})

function collectDiagnostics(state) {
  const found = []
  syntaxTree(state).iterate({
    enter(node) {
      if (!node.type.isError || found.length >= 50) return
      const pos = Math.min(node.from, Math.max(0, state.doc.length - 1))
      const line = state.doc.lineAt(pos)
      found.push({
        from: node.from,
        to: Math.max(node.to, node.from + 1),
        line: line.number,
        column: pos - line.from + 1,
        message: 'Синтаксическая ошибка',
      })
    },
  })
  return found
}

function Minimap({ value, onJump }) {
  const rows = useMemo(() => {
    const lines = String(value || '').split('\n')
    const step = Math.max(1, Math.ceil(lines.length / 220))
    return lines.filter((_, index) => index % step === 0).slice(0, 220).map((line, index) => {
      const clean = line.trim()
      const tone = /^\s*(\/\/|\/\*|\*|<!--|#)/.test(line) ? 'comment'
        : /["'`].*["'`]/.test(line) ? 'string'
          : /\b(function|class|const|let|var|return|import|export|interface|type)\b/.test(line) ? 'keyword' : ''
      return { key: index, width: Math.max(2, Math.min(100, clean.length * 2.3)), tone }
    })
  }, [value])
  return (
    <button className="editor-minimap" type="button" aria-label="Мини-карта файла" onClick={onJump}>
      <span className="minimap-lines">
        {rows.map((row) => <i key={row.key} className={row.tone} style={{ width: `${row.width}%` }} />)}
      </span>
    </button>
  )
}

// variant='editor' — полноценный редактор (FilesPage)
// variant='readable' — подсветка без правки (код в чате и панели), синк value извне
export default function CodeEditor({
  value,
  path = '',
  variant = 'editor',
  onChange,
  onSave,
  onSelectionChange,
  onDiagnostics,
  onGoToDefinition,
  formatRequest = 0,
  jumpTo,
  showMinimap = true,
  className,
}) {
  const host = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onSelectionRef = useRef(onSelectionChange)
  const onDiagnosticsRef = useRef(onDiagnostics)
  const onDefinitionRef = useRef(onGoToDefinition)
  const diagnosticsTimer = useRef(null)
  const lastFormatRequest = useRef(formatRequest)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onSelectionRef.current = onSelectionChange
  onDiagnosticsRef.current = onDiagnostics
  onDefinitionRef.current = onGoToDefinition

  const editable = variant === 'editor'

  useEffect(() => {
    const scheduleDiagnostics = (state) => {
      if (!editable || !onDiagnosticsRef.current) return
      clearTimeout(diagnosticsTimer.current)
      diagnosticsTimer.current = setTimeout(() => onDiagnosticsRef.current?.(collectDiagnostics(state)), 180)
    }
    const extensions = editable
      ? [
          basicSetup,
          oneDark,
          editorTheme,
          Prec.high(
            keymap.of([
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  onSaveRef.current?.()
                  return true
                },
              },
              {
                key: 'F12',
                preventDefault: true,
                run: () => {
                  onDefinitionRef.current?.()
                  return true
                },
              },
            ])
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              onChangeRef.current?.(u.state.doc.toString())
              scheduleDiagnostics(u.state)
            }
            if (u.docChanged || u.selectionSet) {
              const sel = u.state.selection.main
              const word = u.state.wordAt(sel.head)
              const line = u.state.doc.lineAt(sel.head)
              onSelectionRef.current?.({
                from: sel.from,
                to: sel.to,
                text: u.state.doc.sliceString(sel.from, sel.to),
                word: word ? u.state.doc.sliceString(word.from, word.to) : '',
                line: line.number,
                column: sel.head - line.from + 1,
              })
            }
          }),
        ]
      : [
          readableTheme,
          syntaxHighlighting(chatHighlight),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
        ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions: [...extensions, ...langFor(path)] }),
      parent: host.current,
    })
    viewRef.current = view
    scheduleDiagnostics(view.state)
    return () => {
      clearTimeout(diagnosticsTimer.current)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, path])

  // Синхронизация документа при внешней замене (стриминг, отмена, применение diff).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (value !== cur) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    if (!editable || formatRequest === lastFormatRequest.current) return
    lastFormatRequest.current = formatRequest
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (/\.json$/i.test(path)) {
      try {
        const formatted = JSON.stringify(JSON.parse(current), null, 2) + '\n'
        if (formatted !== current) view.dispatch({ changes: { from: 0, to: current.length, insert: formatted } })
        return
      } catch { /* диагностика покажет ошибку JSON */ }
    }
    const changes = indentRange(view.state, 0, view.state.doc.length)
    view.dispatch({ changes })
  }, [formatRequest, editable, path])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !jumpTo) return
    const requestedLine = Number(jumpTo.line || 1)
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, requestedLine)))
    const pos = Math.min(line.to, line.from + Math.max(0, Number(jumpTo.column || 1) - 1))
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    view.focus()
  }, [jumpTo])

  const jumpFromMinimap = (event) => {
    const view = viewRef.current
    if (!view) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.round(1 + ratio * (view.state.doc.lines - 1)))))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }

  if (!editable) return <div ref={host} className={className} />
  return (
    <div className={`${className || ''} editor-code-shell`}>
      <div ref={host} className="editor-code-main" />
      {showMinimap && <Minimap value={value} onJump={jumpFromMinimap} />}
    </div>
  )
}
