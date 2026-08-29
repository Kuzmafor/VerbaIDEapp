import React from 'react'
import { IconClose } from './Icons'

export default function ConfirmSheet({
  open,
  title = 'Подтвердите действие',
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
  children,
}) {
  if (!open) return null
  return (
    <div className="confirm-backdrop" onClick={onCancel} role="presentation">
      <section className="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-handle" />
        <div className="confirm-head">
          <b id="confirm-title">{title}</b>
          <button className="iconbtn small" onClick={onCancel} aria-label="Закрыть"><IconClose /></button>
        </div>
        {message && <p>{message}</p>}
        {children}
        <div className="confirm-actions">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className={'btn ' + (danger ? 'confirm-danger' : 'btn-primary')} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
