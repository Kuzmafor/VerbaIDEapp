// Генерация иконок лаунчера Android из tools/icon-full.svg и tools/icon-glyph.svg
// Запуск: node tools/gen-icons.mjs
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'

const RES = 'android/app/src/main/res'
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }

const full = fs.readFileSync('tools/icon-full.svg', 'utf8')
const glyph = fs.readFileSync('tools/icon-glyph.svg', 'utf8')

const render = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

for (const [dpi, size] of Object.entries(sizes)) {
  const dir = `${RES}/mipmap-${dpi}`
  fs.writeFileSync(`${dir}/ic_launcher.png`, render(full, size))
  fs.writeFileSync(`${dir}/ic_launcher_round.png`, render(full, size))
  // adaptive foreground: холст 108dp при 48dp базовом → ×2.25
  fs.writeFileSync(`${dir}/ic_launcher_foreground.png`, render(glyph, Math.round(size * 2.25)))
}
fs.mkdirSync('public/icons', { recursive: true })
fs.writeFileSync('public/icons/icon-192.png', render(full, 192))
fs.writeFileSync('public/icons/icon-512.png', render(full, 512))
fs.writeFileSync('public/icons/icon-maskable-512.png', render(glyph, 512))
console.log('✓ иконки сгенерированы')
