// ReviewSheet — нижний sheet с единым списком всех предлагаемых AI-изменений.
// Показывает построчный diff, чекбоксы выбора, кнопки применения и отмены сессии.

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { IconClose, IconCheck, IconChevronDown, IconRefresh, IconStop } from './Icons'

// Построчный diff-вьювер: красит добавленные/удалённые/контекстные строки
function DiffView({ diff, maxLines = 60 }) {
  const lines = useMemo(() => {
    const { beforeLines, afterLines, prefix, suffix, removed, added } = diff
    const out = []

    // Контекст до (до 2 строк)
    const ctxBefore = Math.min(2, prefix)
    for (let i = prefix - ctxBefore; i < prefix; i++) {
      if (i >= 0) out.push({ kind: 'context', text: beforeLines[i] })
    }

    // Удалённые
    for (const line of removed) out.push({ kind: 'removed', text: line })

    // Добавленные
    for (const line of added) out.push({ kind: 'added', text: line })

    // Контекст после (до 2 строк)
    const ctxAfter = Math.min(2, suffix)
    for (let i = 0; i < ctxAfter; i++) {
      const idx = afterLines.length - suffix + i
      if (idx >= 0 && idx < afterLines.length) out.push({ kind: 'context', text: afterLines[idx] })
    }

    return out
  }, [diff])

  const shown = lines.length > maxLines ? lines.slice(0, maxLines) : lines
  const truncated = lines.length - shown.length

  return (
    <div className="diff-view">
      {shown.map((line, i) => (
        <div key={i} className={'diff-line diff-' + line.kind}>
          <span className="diff-marker">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span>
          <code className="diff-text">{line.text || '\u00A0'}</code>
        </div>
      ))}
      {truncated > 0 && (
        <div className="diff-truncated">… ещё {truncated} строк</div>
      )}
    </div>
  )
}

// Одна карточка файла в списке правок
function EditCard({ edit, onToggle, onExpand }) {
  const [expanded, setExpanded] = useState(false)
  const { path, diff, selected, applied, rejected } = edit

  const status = applied ? 'applied' : rejected ? 'rejected' : selected ? 'pending' : 'unselected'
  const statusLabel = applied ? 'применён' : rejected ? 'отклонён' : diff.isNew ? 'новый' : 'изменён'

  return (
    <div className={'edit-card edit-' + status}>
      <div className="edit-card-head" onClick={() => { setExpanded(v => !v); onExpand?.() }}>
        <label className="edit-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            disabled={applied || rejected}
            onChange={(e) => onToggle(edit.id, e.target.checked)}
          />
          <span className="edit-check-box">
            {(selected || applied) && !rejected && <IconCheck width={13} height={13} />}
          </span>
        </label>
        <span className="edit-path" title={path}>{path}</span>
        <span className={'edit-status edit-status-' + status}>{statusLabel}</span>
        <span className="edit-delta">
          {diff.addedCount > 0 && <span className="delta-add">+{diff.addedCount}</span>}
          {diff.removedCount > 0 && <span className="delta-del">-{diff.removedCount}</span>}
        </span>
        <IconChevronDown width={14} height={14} className={'edit-twist' + (expanded ? ' open' : '')} />
      </div>
      {expanded && (
        <div className="edit-card-body">
          <DiffView diff={diff} />
        </div>
      )}
    </div>
  )
}

// Сводка по результатам проверки
function CheckResult({ result }) {
  if (!result) return null
  const { ok, output, command, running } = result
  return (
    <div className={'review-check ' + (running ? 'running' : ok ? 'ok' : 'fail')}>
      <div className="review-check-head">
        {running ? (
          <>
            <ThinkingDots />
            <span>Проверка: {command}</span>
          </>
        ) : ok ? (
          <>
            <IconCheck width={15} height={15} />
            <span>Проверка пройдена</span>
          </>
        ) : (
          <>
            <span className="review-check-fail-icon">!</span>
            <span>Проверка не пройдена</span>
          </>
        )}
      </div>
      {!running && output && (
        <details className="review-check-output">
          <summary>Вывод проверки</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="thinking-dots">
      <span /><span /><span />
    </span>
  )
}

export default function ReviewSheet({
  open,
  edits,
  summary,
  checkResult,
  onToggleEdit,
  onSelectAll,
  onDeselectAll,
  onApply,
  onRevertSession,
  onClose,
  onRunCheck,
}) {
  if (!open) return null

  const hasEdits = edits.length > 0
  const canApply = summary.selected > 0
  const canPush = checkResult?.ok && !checkResult?.running

  return (
    <div className="review-backdrop" onClick={onClose} role="presentation">
      <section className="review-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-handle" />
        <div className="review-head">
          <b>Предлагаемые изменения</b>
          <button className="iconbtn small" onClick={onClose} aria-label="Закрыть"><IconClose /></button>
        </div>

        {/* Сводка */}
        <div className="review-summary">
          <span className="rs-stat">
            <b>{summary.selected}</b> выбрано
          </span>
          <span className="rs-stat">
            <b>{summary.totalAdded}</b>
            <span className="delta-add">+</span>
          </span>
          <span className="rs-stat">
            <b>{summary.totalRemoved}</b>
            <span className="delta-del">-</span>
          </span>
          <span className="rs-stat">
            <b>{summary.applied}</b> применено
          </span>
          <div className="rs-actions">
            <button className="mini-btn" onClick={onSelectAll} disabled={!hasEdits}>Все</button>
            <button className="mini-btn" onClick={onDeselectAll} disabled={!hasEdits}>Снять</button>
          </div>
        </div>

        {/* Список правок */}
        <div className="review-edits">
          {edits.length === 0 ? (
            <div className="review-empty">Нет предлагаемых изменений</div>
          ) : (
            edits.map((edit) => (
              <EditCard
                key={edit.id}
                edit={edit}
                onToggle={onToggleEdit}
              />
            ))
          )}
        </div>

        {/* Результат проверки */}
        {checkResult && <CheckResult result={checkResult} />}

        {/* Кнопки */}
        <div className="review-actions">
          {checkResult?.running ? (
            <button className="btn" disabled>
              <ThinkingDots /> Проверка…
            </button>
          ) : (
            <>
              <button className="btn" onClick={onRunCheck} disabled={!hasEdits}>
                <IconRefresh width={14} height={14} /> Проверить
              </button>
              <button
                className={'btn ' + (canPush ? 'btn-primary' : 'btn-blocked')}
                onClick={onApply}
                disabled={!canApply}
                title={!canPush && checkResult ? 'Проверка не пройдена — push заблокирован' : ''}
              >
                <IconCheck width={14} height={14} /> Применить выбранное
              </button>
            </>
          )}
        </div>

        {/* Отмена всей AI-сессии */}
        <button className="review-revert-btn" onClick={onRevertSession}>
          <IconStop width={13} height={13} /> Отменить всю AI-сессию
        </button>
      </section>
    </div>
  )
}
