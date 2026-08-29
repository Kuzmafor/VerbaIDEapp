// Перехват ошибок рендера: без него любое исключение в дереве компонентов гасит
// экран в чёрное, и на телефоне из этого не выйти — помогает только очистка
// данных приложения. Здесь показываем, что случилось, и даём выйти самому.

import React from 'react'
import ConfirmSheet from './ConfirmSheet'

const STORAGE_KEYS = ['verbaide.settings', 'verbaide.chats']

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null, confirmReset: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('render error', error, info)
    this.setState({ info })
  }

  reload = () => {
    window.location.reload()
  }

  clearChats = () => {
    try {
      localStorage.removeItem('verbaide.chats')
    } catch { /* ignore */ }
    window.location.reload()
  }

  resetAll = () => {
    this.setState({ confirmReset: true })
  }

  doResetAll = () => {
    for (const key of STORAGE_KEYS) {
      try {
        localStorage.removeItem(key)
      } catch { /* ignore */ }
    }
    window.location.reload()
  }

  copyDetails = async () => {
    const { error, info } = this.state
    const text = [
      String(error?.stack || error?.message || error),
      info?.componentStack || '',
    ].join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch { /* ignore */ }
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <h2>Что-то сломалось</h2>
          <p>Экран не удалось построить. Приложение цело — можно перезагрузить и продолжить.</p>
          <pre className="crash-msg">{String(error?.message || error)}</pre>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={this.reload}>Перезагрузить</button>
            <button className="btn" onClick={this.clearChats}>Очистить историю чатов</button>
            <button className="btn" onClick={this.copyDetails}>Скопировать детали</button>
            <button className="btn crash-danger" onClick={this.resetAll}>Сбросить настройки</button>
          </div>
          <details className="crash-details">
            <summary>Подробности</summary>
            <pre>{String(error?.stack || '')}{info?.componentStack || ''}</pre>
          </details>
        </div>
        <ConfirmSheet
          open={this.state.confirmReset}
          title="Сбросить приложение?"
          message="Будут удалены настройки, провайдеры и история чатов. Сохранённые проекты останутся."
          confirmLabel="Сбросить"
          danger
          onCancel={() => this.setState({ confirmReset: false })}
          onConfirm={this.doResetAll}
        />
      </div>
    )
  }
}
