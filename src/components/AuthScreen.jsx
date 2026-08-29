import React, { useState } from 'react'
import { IconArrowUp, IconCheck, IconClose } from './Icons'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const AUTH_KEY = 'verbaide.access-mode'

export function hasChosenAccess() {
  try { return !!localStorage.getItem(AUTH_KEY) } catch { return false }
}

export default function AuthScreen({ onGuest, onAuthenticated }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('email')
  const [notice, setNotice] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.hash.slice(1))
      return params.get('telegram_error') || ''
    } catch { return '' }
  })
  const [busy, setBusy] = useState(false)
  const startTelegram = () => {
    if (!isSupabaseConfigured()) return setNotice('Supabase ещё не настроен в приложении.')
    // Client Secret остаётся в Edge Function. В браузер передаётся только
    // адрес запуска авторизации, поэтому его нельзя извлечь из сайта или APK.
    const authUrl = `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/telegram-login?action=start`
    window.location.assign(authUrl)
  }
  const guest = () => {
    try { localStorage.setItem(AUTH_KEY, 'guest') } catch { /* ignore */ }
    onGuest()
  }
  const sendCode = async (event) => {
    event.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setNotice('Введите корректный адрес электронной почты.')
    if (!isSupabaseConfigured()) return setNotice('Supabase ещё не настроен в приложении.')
    setBusy(true)
    setNotice('')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    setBusy(false)
    if (error) {
      const raw = error.message || 'Неизвестная ошибка отправки'
      const smtpFailure = /sending confirmation email|sending.*email/i.test(raw)
      return setNotice(smtpFailure
        ? 'Supabase не смог отправить письмо через SMTP. Проверьте подтверждённый домен и Sender email в Resend, а также Host, Username и API key в Supabase → Emails → SMTP Settings.'
        : raw)
    }
    setStep('code')
    setNotice('Код отправлен. Проверьте «Входящие» и папку «Спам».')
  }
  const verifyCode = async (event) => {
    event.preventDefault()
    const token = code.replace(/\D/g, '')
    if (token.length !== 6) return setNotice('Введите шестизначный код из письма.')
    setBusy(true)
    setNotice('')
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    setBusy(false)
    if (error || !data.session) return setNotice(error?.message || 'Не удалось подтвердить код. Запросите новый.')
    try { localStorage.setItem(AUTH_KEY, 'supabase') } catch { /* ignore */ }
    onAuthenticated?.(data.user)
  }
  return <div className="auth-screen">
    <div className="auth-stars" aria-hidden="true" />
    <div className="auth-card">
      <div className="auth-top"><span className="auth-brand">Verbal<span>IDE</span></span><span className="auth-lang">RU⌄</span><button className="auth-close" onClick={guest} aria-label="Продолжить гостем"><IconClose width={17} height={17} /></button></div>
      <div className="auth-eyebrow"><IconCheck width={14} height={14} /> БЕЗОПАСНЫЙ ДОСТУП</div>
      <h1>{step === 'email' ? 'Создать аккаунт' : 'Введите код'}</h1>
      <p className="auth-lead">{step === 'email' ? 'Синхронизируйте проекты, память и настройки между устройствами.' : <>Отправили шестизначный код на <b>{email}</b>.</>}</p>
      {step === 'email' ? <form onSubmit={sendCode}>
        <label>Адрес электронной почты<input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value.trim())} inputMode="email" autoComplete="email" placeholder="name@example.com" /></label>
        <small>Подойдёт любой корректный email-домен.</small>
        <button className="auth-primary" disabled={busy} type="submit">{busy ? 'Отправляю…' : <>Отправить код <IconArrowUp width={17} height={17} /></>}</button>
      </form> : <form onSubmit={verifyCode}>
        <label>Код из письма<input className="auth-input auth-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></label>
        <small><button className="auth-text-btn" type="button" onClick={() => { setStep('email'); setCode(''); setNotice('') }}>Изменить email или отправить новый код</button></small>
        <button className="auth-primary" disabled={busy} type="submit">{busy ? 'Проверяю…' : 'Войти в VerbaIDE'}</button>
      </form>}
      {notice && <div className="auth-notice">{notice}</div>}
      {step === 'email' && <><div className="auth-or"><span /> или продолжить через <span /></div>
      <div className="auth-social">
        <button type="button" onClick={startTelegram} disabled={busy}>
          <svg className="telegram-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.1 3.5 2.9 10.7c-1.25.5-1.24 1.2-.23 1.5l4.67 1.46 1.8 5.49c.22.61.11.85.76.85.5 0 .72-.23 1-.5l2.27-2.2 4.72 3.49c.87.48 1.5.23 1.72-.8L22.7 5c.33-1.27-.49-1.84-1.6-1.5ZM8.1 13.33l10.54-6.65c.53-.32 1.01-.15.61.2l-9.02 8.14-.35 3.73-1.78-5.42Z" /></svg><b>Telegram</b>
        </button>
        <button type="button" onClick={() => setNotice('Вход через Google будет доступен после подключения сервера авторизации.')}><span className="google-mark">G</span><b>Google</b></button>
      </div></>}
      <button className="auth-guest" type="button" onClick={guest}>Продолжить как гость <span>→</span></button>
      <p className="auth-foot">Гостевой режим хранит данные только на этом устройстве.</p>
    </div>
  </div>
}
