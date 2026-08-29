// Локальный профиль устройства: стабильный UID + единый аватар

const UID_KEY = 'verbaide.uid'

export function getProfile() {
  let uid = localStorage.getItem(UID_KEY)
  if (!uid) {
    const bytes = crypto.getRandomValues(new Uint8Array(4))
    uid = 'VB-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    localStorage.setItem(UID_KEY, uid)
  }
  return { uid }
}

// Один универсальный аватар на все локальные профили: различать устройства
// картинкой незачем — рядом и так виден UID.
export function Avatar({ size = 36, round = true }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Аватар профиля"
      style={{ borderRadius: round ? '50%' : '26%', flex: 'none', display: 'block' }}
    >
      <defs>
        <linearGradient id="avatar-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#33333d" />
          <stop offset="1" stopColor="#1c1c22" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" fill="url(#avatar-bg)" />
      <circle cx="20" cy="15.4" r="6.3" fill="#9d9daa" />
      <path d="M7.5 35.6c1.2-7.1 6.3-11 12.5-11s11.3 3.9 12.5 11z" fill="#9d9daa" />
    </svg>
  )
}
