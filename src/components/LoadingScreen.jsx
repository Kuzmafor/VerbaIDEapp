import React, { useEffect, useRef, useState } from 'react'

// Загрузочный экран: живая волна из точек на canvas + название + круговой спиннер.
export default function LoadingScreen({ hide }) {
  const ref = useRef(null)
  const [motto, setMotto] = useState('')

  // Та же спокойная печатающая подача, что у подсказки в композере.
  useEffect(() => {
    const phrase = 'Verba volant, scripta manent'
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setMotto(phrase)
      return undefined
    }
    let index = 0
    let timer
    const type = () => {
      index += 1
      setMotto(phrase.slice(0, index))
      timer = index < phrase.length
        ? setTimeout(type, 47 + Math.random() * 28)
        : setTimeout(() => { index = 0; setMotto(''); timer = setTimeout(type, 850) }, 1700)
    }
    timer = setTimeout(type, 260)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf = 0
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, w * dpr)
      canvas.height = Math.max(1, h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const start = performance.now()
    const draw = (now) => {
      const t = (now - start) / 1000
      ctx.clearRect(0, 0, w, h)

      // Полноэкранное поле точек. Раньше фиксированные 13 рядов занимали только
      // верхнюю треть высокого телефона; теперь плотность зависит от высоты.
      const gapX = Math.max(20, w / 18)
      const cols = Math.ceil(w / gapX) + 2
      const rows = Math.min(42, Math.max(24, Math.ceil(h / 27)))
      for (let r = 0; r < rows; r++) {
        const depth = r / (rows - 1) // 0 — дальний ряд, 1 — ближний
        const baseY = h * (0.035 + depth * 0.93)
        for (let c = 0; c < cols; c++) {
          const x = c * gapX - gapX / 2 + (r % 2 ? gapX * 0.28 : 0) + Math.sin(t * 0.6 + c * 0.5 + r * 0.3) * 4
          const phase = t * 1.5 + c * 0.42 + r * 0.6
          const y =
            baseY +
            Math.sin(phase) * (5 + depth * 13) +
            Math.sin(t * 0.7 + c * 0.13 + r * 0.22) * (3 + depth * 7)
          const twinkle = 0.55 + 0.45 * Math.sin(phase * 1.7 + c)
          // Сохраняем контраст логотипа: в центре точки мягче, по краям ярче.
          const centerDistance = Math.min(1, Math.abs(y - h * 0.55) / (h * 0.32))
          const alpha = (0.055 + depth * 0.32) * (0.58 + centerDistance * 0.42) * twinkle
          const size = 0.7 + depth * 1.35
          ctx.beginPath()
          ctx.arc(x, y, size, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(130, 165, 255, ${alpha.toFixed(3)})`
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className={'splash' + (hide ? ' fade' : '')}>
      <canvas ref={ref} className="splash-canvas" />
      <div className="splash-center">
        <div className="splash-name">
          Verba<span>IDE</span>
        </div>
        <div className="splash-sub">Мобильная IDE с ИИ-агентом</div>
        <svg className="spin-ring" viewBox="0 0 36 36" aria-label="Загрузка">
          <circle className="spin-track" cx="18" cy="18" r="16" pathLength="100" />
          <circle className="spin-arc" cx="18" cy="18" r="16" pathLength="100" />
        </svg>
      </div>
      <div className="splash-motto" aria-label="Verba volant, scripta manent">{motto}<i aria-hidden="true" /></div>
      <div className="splash-foot">v0.3.0</div>
    </div>
  )
}
