import React, { useState } from 'react'
import CodeEditor from './CodeEditor'
import { IconBulb, IconCode, IconCopy } from './Icons'
import { splitFences } from '../lib/fences'

// Мини-рендерер markdown: абзацы, **жирный**, `код` и блоки ```
// Без внешних зависимостей и без dangerouslySetInnerHTML

function inline(text) {
  const nodes = []
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('`')) nodes.push(<code key={m.index}>{t.slice(1, -1)}</code>)
    else nodes.push(<strong key={m.index}>{t.slice(2, -2)}</strong>)
    last = m.index + t.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// Модель часто оформляет ответ заголовками «## Шаг 1». Раньше решётки
// попадали в текст как есть, поэтому разбираем их здесь.
const HEADING = /^(#{1,6})\s+(.*)$/

function Heading({ level, text }) {
  return (
    <div className={'md-head md-h' + level}>
      {level === 2 && <IconBulb width={15} height={15} className="md-head-icon" />}
      <span>{inline(text)}</span>
    </div>
  )
}

function Prose({ text }) {
  if (!text.trim()) return null
  // Разбор построчный: заголовок может идти без пустой строки перед ним,
  // поэтому делить текст только по \n{2,} недостаточно.
  const blocks = []
  let buffer = []
  const flush = () => {
    if (!buffer.length) return
    blocks.push({ type: 'p', lines: buffer })
    buffer = []
  }
  for (const raw of text.split('\n')) {
    const match = HEADING.exec(raw.trim())
    if (match) {
      flush()
      blocks.push({ type: 'h', level: match[1].length, text: match[2] })
    } else if (!raw.trim()) {
      flush()
    } else {
      buffer.push(raw)
    }
  }
  flush()
  return (
    <>
      {blocks.map((block, i) =>
        block.type === 'h' ? (
          <Heading key={i} level={block.level} text={block.text} />
        ) : (
          <p key={i}>
            {block.lines.map((line, j, arr) => (
              <React.Fragment key={j}>
                {inline(line)}
                {j < arr.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        )
      )}
    </>
  )
}

function CodeBlock({ raw, extra }) {
  const nl = raw.indexOf('\n')
  const info = nl >= 0 ? raw.slice(0, nl).trim() : ''
  const code = nl >= 0 ? raw.slice(nl + 1) : raw
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* ignore */ }
  }
  return (
    <div className="codeblock">
      <div className="code-head">
        <IconCode width={14} height={14} className="code-kind" />
        <span className="code-path">{info || 'код'}</span>
        <span className="grow" />
        <button className="code-copy" onClick={copy} aria-label="Копировать код">
          <IconCopy width={13} height={13} />
          <span>{copied ? 'Скопировано' : 'Копировать'}</span>
        </button>
        {extra}
      </div>
      <CodeEditor variant="readable" value={code} path={info || ''} className="codeblock-cm" />
    </div>
  )
}

// codeExtra(raw) — доп. узел в шапке блока (кнопка «Применить»)
// fileCard(raw) — если задан, файловые блоки рендерятся через него (карточка файла);
//                 вернуть из него undefined/null → обычный CodeBlock
// raw остаётся в прежнем виде «информационная строка \n код», чтобы вызывающий
// код разбирал его как раньше.
export default function Markdown({ text, codeExtra, fileCard }) {
  const parts = splitFences(text)
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'code') {
          const raw = part.info + '\n' + part.code
          const card = fileCard ? fileCard(raw) : null
          if (card) return card
          return <CodeBlock key={i} raw={raw} extra={codeExtra ? codeExtra(raw) : null} />
        }
        return <Prose key={i} text={part.code} />
      })}
    </>
  )
}
