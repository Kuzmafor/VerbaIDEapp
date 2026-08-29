import { requestJson } from './http'

function endpoint(provider, path) { return String(provider.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '') + '/v1' + path }
export async function generateImage(provider, { prompt, model = 'gpt-image-1', size = '1024x1024' }) {
  const res = await requestJson({ url: endpoint(provider, '/images/generations'), method: 'POST', headers: { Authorization: 'Bearer ' + provider.apiKey, 'Content-Type': 'application/json' }, body: { model, prompt, size } })
  if (!res.ok) throw new Error(res.json?.()?.error?.message || `HTTP ${res.status}`)
  const data = res.json()
  const image = data?.data?.[0]
  if (image?.b64_json) return { url: 'data:image/png;base64,' + image.b64_json }
  if (image?.url) return { url: image.url }
  throw new Error('Провайдер не вернул изображение')
}
