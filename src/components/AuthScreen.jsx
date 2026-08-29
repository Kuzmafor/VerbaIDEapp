import React, { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { IconArrowUp, IconCheck, IconClose } from './Icons'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useStore } from '../store'

const AUTH_KEY = 'verbaide.access-mode'

export function hasChosenAccess() {
  try { return !!localStorage.getItem(AUTH_KEY) } catch { return false }
}

export default function AuthScreen({ onGuest, onAuthenticated }) {
  const { settings, setSettings } = useStore()
  const english = settings.locale === 'en'
  const copy = english ? {
    guestAria: 'Continue as guest', secure: 'SECURE ACCESS', create: 'Create account', codeTitle: 'Enter code',
    lead: 'Sync projects, memory, and settings across your devices.', emailSent: 'We sent a six-digit code to',
    email: 'Email address', validDomain: 'Any valid email domain will work.', send: 'Send code', sending: 'Sending…',
    emailCode: 'Code from email', changeEmail: 'Change email or send a new code', verify: 'Checking…', signIn: 'Sign in to VerbaIDE',
    or: 'or continue with', vkNotice: 'VK sign-in will be available after VK ID is connected.',
    guest: 'Continue as guest', guestFoot: 'Guest mode keeps data only on this device.',
    invalidEmail: 'Enter a valid email address.', supabaseMissing: 'Supabase is not configured in the app.', codeSent: 'Code sent. Check your inbox and Spam folder.',
    invalidCode: 'Enter the six-digit code from the email.', verifyFailed: 'Could not verify the code. Request a new one.',
  } : {
    guestAria: 'Продолжить гостем', secure: 'БЕЗОПАСНЫЙ ДОСТУП', create: 'Создать аккаунт', codeTitle: 'Введите код',
    lead: 'Синхронизируйте проекты, память и настройки между устройствами.', emailSent: 'Отправили шестизначный код на',
    email: 'Адрес электронной почты', validDomain: 'Подойдёт любой корректный email-домен.', send: 'Отправить код', sending: 'Отправляю…',
    emailCode: 'Код из письма', changeEmail: 'Изменить email или отправить новый код', verify: 'Проверяю…', signIn: 'Войти в VerbaIDE',
    or: 'или продолжить через', vkNotice: 'Вход через VK будет доступен после подключения VK ID.',
    guest: 'Продолжить как гость', guestFoot: 'Гостевой режим хранит данные только на этом устройстве.',
    invalidEmail: 'Введите корректный адрес электронной почты.', supabaseMissing: 'Supabase ещё не настроен в приложении.', codeSent: 'Код отправлен. Проверьте «Входящие» и папку «Спам».',
    invalidCode: 'Введите шестизначный код из письма.', verifyFailed: 'Не удалось подтвердить код. Запросите новый.',
  }
  const [languageOpen, setLanguageOpen] = useState(false)
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
    if (!isSupabaseConfigured()) return setNotice(copy.supabaseMissing)
    // Client Secret остаётся в Edge Function. В браузер передаётся только
    // адрес запуска авторизации, поэтому его нельзя извлечь из сайта или APK.
    const nativeReturn = Capacitor.isNativePlatform() ? '&return_to=verbaide%3A%2F%2Fauth' : ''
    const authUrl = `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/telegram-login?action=start${nativeReturn}`
    window.location.assign(authUrl)
  }
  const guest = () => {
    try { localStorage.setItem(AUTH_KEY, 'guest') } catch { /* ignore */ }
    onGuest()
  }
  const sendCode = async (event) => {
    event.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setNotice(copy.invalidEmail)
    if (!isSupabaseConfigured()) return setNotice(copy.supabaseMissing)
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
    setNotice(copy.codeSent)
  }
  const verifyCode = async (event) => {
    event.preventDefault()
    const token = code.replace(/\D/g, '')
    if (token.length !== 6) return setNotice(copy.invalidCode)
    setBusy(true)
    setNotice('')
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    setBusy(false)
    if (error || !data.session) return setNotice(error?.message || copy.verifyFailed)
    try { localStorage.setItem(AUTH_KEY, 'supabase') } catch { /* ignore */ }
    onAuthenticated?.(data.user)
  }
  return <div className="auth-screen">
    <div className="auth-stars" aria-hidden="true" />
    <div className="auth-card">
      <div className="auth-top"><span className="auth-brand">Verbal<span>IDE</span></span><div className="auth-language-wrap"><button className={'auth-lang' + (languageOpen ? ' open' : '')} type="button" onClick={() => setLanguageOpen((open) => !open)} aria-expanded={languageOpen} aria-label="Выбрать язык интерфейса"><span>{english ? 'EN' : 'RU'}</span><i /></button><div className={'auth-language-sheet' + (languageOpen ? ' open' : '')} aria-hidden={!languageOpen}><button className={!english ? 'active' : ''} onClick={() => { setSettings((s) => ({ ...s, locale: 'ru' })); setLanguageOpen(false) }}><b>Русский</b><small>RU</small></button><button className={english ? 'active' : ''} onClick={() => { setSettings((s) => ({ ...s, locale: 'en' })); setLanguageOpen(false) }}><b>English</b><small>EN</small></button></div></div><button className="auth-close" onClick={guest} aria-label={copy.guestAria}><IconClose width={17} height={17} /></button></div>
      <div className="auth-eyebrow"><IconCheck width={14} height={14} /> {copy.secure}</div>
      <h1>{step === 'email' ? copy.create : copy.codeTitle}</h1>
      <p className="auth-lead">{step === 'email' ? copy.lead : <>{copy.emailSent} <b>{email}</b>.</>}</p>
      {step === 'email' ? <form onSubmit={sendCode}>
        <label>{copy.email}<input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value.trim())} inputMode="email" autoComplete="email" placeholder="name@example.com" /></label>
        <small>{copy.validDomain}</small>
        <button className="auth-primary" disabled={busy} type="submit">{busy ? copy.sending : <>{copy.send} <IconArrowUp width={17} height={17} /></>}</button>
      </form> : <form onSubmit={verifyCode}>
        <label>{copy.emailCode}<input className="auth-input auth-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></label>
        <small><button className="auth-text-btn" type="button" onClick={() => { setStep('email'); setCode(''); setNotice('') }}>{copy.changeEmail}</button></small>
        <button className="auth-primary" disabled={busy} type="submit">{busy ? copy.verify : copy.signIn}</button>
      </form>}
      {notice && <div className="auth-notice">{notice}</div>}
      {step === 'email' && <><div className="auth-or"><span /> {copy.or} <span /></div>
      <div className="auth-social">
        <button type="button" onClick={startTelegram} disabled={busy}>
          <svg className="telegram-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.1 3.5 2.9 10.7c-1.25.5-1.24 1.2-.23 1.5l4.67 1.46 1.8 5.49c.22.61.11.85.76.85.5 0 .72-.23 1-.5l2.27-2.2 4.72 3.49c.87.48 1.5.23 1.72-.8L22.7 5c.33-1.27-.49-1.84-1.6-1.5ZM8.1 13.33l10.54-6.65c.53-.32 1.01-.15.61.2l-9.02 8.14-.35 3.73-1.78-5.42Z" /></svg><b>Telegram</b>
        </button>
        <button type="button" className="vk-login" onClick={() => setNotice(copy.vkNotice)}><svg className="vk-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.84 17.77c-5.65 0-8.87-3.87-9-10.31h2.83c.09 4.72 2.17 6.72 3.82 7.13V7.46h2.66v4.07c1.63-.18 3.35-2.04 3.93-4.07h2.66a7.86 7.86 0 0 1-3.63 5.14 8.14 8.14 0 0 1 4.25 5.17h-2.93c-.63-1.94-2.2-3.46-4.28-3.66v3.66Z"/></svg><b>VK</b></button>
      </div></>}
      <button className="auth-guest" type="button" onClick={guest}>{copy.guest} <span>→</span></button>
      <p className="auth-foot">{copy.guestFoot}</p>
    </div>
  </div>
}
