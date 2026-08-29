// Единая точка общения с LLM: стриминг SSE, инструменты (tool use), размышления.
// Внутренний формат сообщений:
//   { role:'user', content:string }
//   { role:'assistant', content:string, toolCalls?:[{id,name,args}], thinkingBlocks?:[] }
//   { role:'tool', id, name, content:string }
// streamChat yield'ит события {kind:'text'|'reasoning'|'tool_use', ...}
// и возвращает { text, thinkingBlocks, stopReason }.

import { describeNetworkError, isNetworkError, requestJson, streamPost } from './http'

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path
}

export function normalizeProviderBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('укажите endpoint')
  let url
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
  } catch {
    throw new Error('некорректный endpoint')
  }
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|messages|models)$/i, '')
    .replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

function endpointCandidates(value) {
  const base = normalizeProviderBaseUrl(value)
  const out = [base]
  const path = new URL(base).pathname.replace(/\/+$/, '')
  if (!/\/v\d+(?:beta)?$/i.test(path)) out.push(joinUrl(base, '/v1'))
  return [...new Set(out)]
}

function modelsFromPayload(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []
  return [...new Set(
    list
      .map((item) => typeof item === 'string' ? item : item?.id || item?.model || item?.name)
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim())
  )].sort((a, b) => a.localeCompare(b))
}

function providerName(baseUrl) {
  const host = new URL(baseUrl).hostname.replace(/^api\./i, '')
  const slug = host.split('.')[0] || 'API'
  const known = {
    anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter',
    deepseek: 'DeepSeek', groq: 'Groq', mistral: 'Mistral', google: 'Google', huggingface: 'Hugging Face',
  }
  return known[slug.toLowerCase()] || slug.charAt(0).toUpperCase() + slug.slice(1)
}

function authHeaders(format, apiKey) {
  if (format === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  return { Authorization: 'Bearer ' + apiKey }
}

export const CAPABILITY_LABELS = {
  vision: 'Vision',
  webSearch: 'Web Search',
  functionCalling: 'Function Calling',
  reasoning: 'Reasoning',
  imageGeneration: 'Генерация изображений',
  videoGeneration: 'Генерация видео',
  responsesApi: 'Responses API',
  realtime: 'Realtime',
}

// Универсального capability endpoint у OpenAI-совместимых API нет, поэтому
// возможности определяются по типу API, хосту и идентификаторам моделей.
export function inferProviderCapabilities({ models = [], format = 'openai', baseUrl = '' }) {
  const haystack = models.join(' ').toLowerCase()
  let host = ''
  try { host = new URL(baseUrl).hostname.toLowerCase() } catch { /* ignore */ }
  const officialOpenAI = host === 'api.openai.com' || host.endsWith('.openai.com')
  const anthropic = format === 'anthropic' || host.includes('anthropic')
  const has = (re) => re.test(haystack)
  return {
    vision: anthropic || officialOpenAI || has(/vision|gpt-4o|gpt-4\.1|gpt-5|claude-[34]|gemini|qwen[^ ]*vl|llava|pixtral/),
    webSearch: officialOpenAI || anthropic || has(/search|sonar|online/),
    // Инструменты не являются обязательной частью OpenAI-compatible API. Если
    // насильно послать `tools` обычной модели на Hugging Face/локальном router,
    // она ответит 400 и сломает даже простой чат.
    functionCalling: anthropic || officialOpenAI || /openrouter|groq|mistral|deepseek/i.test(host) || has(/function|tool[-_ ]?call|gpt-[45]|claude|qwen.*tool/),
    reasoning: anthropic || officialOpenAI || has(/reason|thinking|deepseek-r|qwq|(^|\s)o[1-9]|gpt-5/),
    imageGeneration: officialOpenAI || has(/dall-e|gpt-image|image-gen|flux|sdxl|stable-diffusion/),
    videoGeneration: officialOpenAI && has(/sora|video/) || has(/sora|video-gen|text-to-video|wan-?2|kling|veo/),
    responsesApi: officialOpenAI,
    realtime: officialOpenAI || has(/realtime|live|audio-preview/),
  }
}

// Определяет совместимость endpoint и загружает доступные аккаунту модели.
export async function discoverProvider({ baseUrl, apiKey }) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('укажите API key')
  const failures = []
  let networkUrl = ''

  for (const candidate of endpointCandidates(baseUrl)) {
    for (const format of ['openai', 'anthropic']) {
      const url = joinUrl(candidate, '/models')
      let res
      try {
        res = await requestJson({ url, headers: authHeaders(format, key), timeout: 30000 })
      } catch (err) {
        if (!isNetworkError(err)) throw err
        networkUrl = networkUrl || url
        continue
      }

      if (!res.ok) {
        failures.push(`${new URL(candidate).pathname || '/'}: HTTP ${res.status}`)
        continue
      }

      let payload
      try {
        payload = res.json()
      } catch {
        failures.push(`${new URL(candidate).pathname || '/'}: ответ не JSON`)
        continue
      }
      const models = modelsFromPayload(payload)
      if (!models.length) {
        failures.push(`${new URL(candidate).pathname || '/'}: список моделей пуст`)
        continue
      }

      return {
        name: providerName(candidate),
        baseUrl: candidate,
        apiKey: key,
        format,
        models,
        capabilities: inferProviderCapabilities({ models, format, baseUrl: candidate }),
        capabilitySource: 'endpoint+models',
      }
    }
  }

  if (networkUrl && !failures.length) throw new Error(describeNetworkError(networkUrl))
  throw new Error(failures[0] || 'не удалось получить список моделей')
}

export const FORMAT_LABELS = {
  anthropic: 'Anthropic messages (/v1/messages)',
  openai: 'OpenAI chat completions (/v1/chat/completions)',
}

function parseArgs(s) {
  try {
    return s ? JSON.parse(s) : {}
  } catch {
    return {}
  }
}

// Anthropic требует чередования ролей и запрещает пустые text-блоки: когда модель
// отвечает только вызовом инструмента, текста нет, а после блока с tool_result
// может понадобиться ещё одна user-реплика. Склеиваем такие пары в одно сообщение.
function mergeConsecutive(list) {
  const out = []
  for (const m of list) {
    const content = Array.isArray(m.content)
      ? m.content.filter((b) => b.type !== 'text' || String(b.text || '').trim())
      : String(m.content || '').trim()
        ? [{ type: 'text', text: m.content }]
        : []
    if (!content.length) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content.push(...content)
    else out.push({ role: m.role, content })
  }
  return out
}

function toAnthropicMessages(msgs) {
  const out = []
  for (const m of msgs) {
    if (m.role === 'user') {
      if (m.images?.length) {
        const content = []
        for (const image of m.images) {
          const match = String(image.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
          if (match) content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
        }
        content.push({ type: 'text', text: m.content || 'Проанализируй прикреплённое изображение.' })
        out.push({ role: 'user', content })
      } else out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const content = []
      for (const tb of m.thinkingBlocks || []) {
        content.push({ type: 'thinking', thinking: tb.thinking, signature: tb.signature })
      }
      if (String(m.content || '').trim()) content.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls || []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} })
      }
      out.push({ role: 'assistant', content })
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.id, content: m.content }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block)
      else out.push({ role: 'user', content: [block] })
    }
  }
  return mergeConsecutive(out)
}

function toOpenAIMessages(msgs, system) {
  const out = system ? [{ role: 'system', content: system }] : []
  for (const m of msgs) {
    if (m.role === 'user') {
      if (m.images?.length) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content || 'Проанализируй прикреплённое изображение.' },
            ...m.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
          ],
        })
      } else out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
        }))
      }
      out.push(msg)
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.id, content: m.content })
    }
  }
  return out
}

// Провайдеры возвращают точный расход токенов — раньше он отбрасывался, и
// статистика считалась грубой оценкой по длине текста.
function readUsage(usage, prev) {
  if (!usage) return prev || null
  const input = usage.input_tokens ?? usage.prompt_tokens
  const output = usage.output_tokens ?? usage.completion_tokens
  const cachedRead = usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens
  const cachedWrite = usage.cache_creation_input_tokens
  const out = { ...(prev || {}) }
  if (Number.isFinite(input)) out.input = input
  if (Number.isFinite(output)) out.output = output
  if (Number.isFinite(cachedRead)) out.cachedRead = cachedRead
  if (Number.isFinite(cachedWrite)) out.cachedWrite = cachedWrite
  return Object.keys(out).length ? out : prev || null
}

// Нативный HTTP не умеет отдавать тело по частям, поэтому там запрос уходит без
// stream:true, а обычный ответ разбирается в те же события, что и SSE.
function* eventsFromAnthropicMessage(payload, result) {
  for (const block of payload?.content || []) {
    if (block.type === 'text' && block.text) {
      result.text += block.text
      yield { kind: 'text', value: block.text }
    } else if (block.type === 'thinking' && block.thinking) {
      result.thinkingBlocks.push({ thinking: block.thinking, signature: block.signature || '' })
      yield { kind: 'reasoning', value: block.thinking }
    } else if (block.type === 'tool_use') {
      yield { kind: 'tool_use', call: { id: block.id, name: block.name, args: block.input || {} } }
    }
  }
  result.stopReason = payload?.stop_reason || null
  result.usage = readUsage(payload?.usage)
}

function* eventsFromOpenAIMessage(payload, result) {
  const choice = payload?.choices?.[0]
  const msg = choice?.message || {}
  if (msg.reasoning_content) yield { kind: 'reasoning', value: msg.reasoning_content }
  if (msg.content) {
    result.text += msg.content
    yield { kind: 'text', value: msg.content }
  }
  for (const [i, tc] of (msg.tool_calls || []).entries()) {
    yield {
      kind: 'tool_use',
      call: { id: tc.id || 'call_' + i, name: tc.function?.name, args: parseArgs(tc.function?.arguments) },
    }
  }
  result.stopReason = choice?.finish_reason || null
  result.usage = readUsage(payload?.usage)
}

// Anthropic требует max_tokens, и прежние 8192 обрывали длинный файл на середине.
export const DEFAULT_MAX_OUTPUT_TOKENS = 32000

// Провайдер мог не знать необязательных полей (слишком большой
// max_tokens) — тогда повторяем запрос без них, а не падаем с HTTP 400.
function isUnsupportedParam(message) {
  const text = String(message || '')
  const mentionsParam = /max_tokens|max_completion_tokens|stream_options|tools/i.test(text)
  const mentionsProblem = /unsupported|unrecognized|unknown|not (supported|allowed)|не поддерж/i.test(text)
  return mentionsParam && (mentionsProblem || /too (large|high)|exceed/i.test(text))
}

export async function* streamChat({ provider, model, messages, system, signal, thinking, tools, maxOutputTokens }) {
  const isAnthropic = provider.format === 'anthropic'
  const url = joinUrl(provider.baseUrl, isAnthropic ? '/messages' : '/chat/completions')

  const headers = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = provider.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else {
    headers['Authorization'] = 'Bearer ' + (provider.apiKey || '')
  }

  const limit = Math.max(1024, Number(maxOutputTokens) || DEFAULT_MAX_OUTPUT_TOKENS)

  let body
  if (isAnthropic) {
    body = {
      model,
      max_tokens: limit,
      stream: true,
      messages: toAnthropicMessages(messages),
    }
    if (system) body.system = system
    if (tools?.length) body.tools = tools
    if (thinking) body.thinking = { type: 'enabled', budget_tokens: Math.min(8192, Math.floor(limit / 2)) }
  } else {
    body = {
      model,
      stream: true,
      messages: toOpenAIMessages(messages, system),
      max_tokens: limit,
    }
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    }
  }

  const result = { text: '', thinkingBlocks: [], stopReason: null, usage: null }

  let stream
  try {
    stream = await streamPost({ url, headers, body, signal })
  } catch (err) {
    if (isNetworkError(err)) throw new Error(describeNetworkError(url))
    // Необязательные поля роняют часть OpenAI-совместимых серверов — пробуем без них.
    if (err.status === 400 && !isAnthropic && isUnsupportedParam(err.message)) {
      const { max_tokens: _mt, stream_options: _so, tools: _tools, ...plain } = body
      body = plain
      try {
        stream = await streamPost({ url, headers, body, signal })
      } catch (retryErr) {
        if (isNetworkError(retryErr)) throw new Error(describeNetworkError(url))
        throw new Error(`HTTP ${retryErr.status || ''} от ${provider.name}${String(retryErr.message).replace(/^HTTP \d+/, '')}`)
      }
    } else if (err.status) {
      throw new Error(`HTTP ${err.status} от ${provider.name}${err.message.replace(/^HTTP \d+/, '')}`)
    } else {
      throw err
    }
  }

  if (stream.fallbackNeeded) {
    let res
    try {
      res = await requestJson({
        url,
        method: 'POST',
        headers,
        // stream_options допустим только когда stream:true; часть Router API
        // (включая Hugging Face) отклоняет именно эту комбинацию с HTTP 400.
        body: (() => {
          const { stream_options: _streamOptions, ...plain } = body
          return { ...plain, stream: false }
        })(),
        signal,
        timeout: 600000,
      })
    } catch (err) {
      if (isNetworkError(err)) throw new Error(describeNetworkError(url))
      throw err
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} от ${provider.name}${res.text ? ': ' + res.text.slice(0, 400) : ''}`)
    }
    let payload
    try {
      payload = res.json()
    } catch {
      throw new Error(`${provider.name} вернул не JSON: ${res.text.slice(0, 200)}`)
    }
    if (payload?.error) throw new Error(payload.error.message || 'Ошибка запроса')
    yield* isAnthropic ? eventsFromAnthropicMessage(payload, result) : eventsFromOpenAIMessage(payload, result)
    return result
  }

  const chunkIterator = stream.chunks[Symbol.asyncIterator]()
  const nextChunk = async () => {
    const { done, value } = await chunkIterator.next()
    return done ? null : value
  }
  let buf = ''

  if (isAnthropic) {
    const blocks = new Map()
    while (true) {
      const chunk = await nextChunk()
      if (chunk === null) break
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let ev
        try {
          ev = JSON.parse(data)
        } catch {
          continue
        }
        if (ev.type === 'content_block_start') {
          const cb = ev.content_block || {}
          blocks.set(ev.index, {
            type: cb.type,
            text: '',
            thinking: '',
            signature: '',
            tool: cb.type === 'tool_use' ? { id: cb.id, name: cb.name, json: '' } : null,
          })
        } else if (ev.type === 'content_block_delta') {
          const b = blocks.get(ev.index)
          if (!b) continue
          const d = ev.delta || {}
          if (d.type === 'text_delta' && d.text) {
            b.text += d.text
            yield { kind: 'text', value: d.text }
          } else if (d.type === 'thinking_delta' && d.thinking) {
            b.thinking += d.thinking
            yield { kind: 'reasoning', value: d.thinking }
          } else if (d.type === 'signature_delta' && d.signature) {
            b.signature += d.signature
          } else if (d.type === 'input_json_delta' && d.partial_json && b.tool) {
            b.tool.json += d.partial_json
          }
        } else if (ev.type === 'content_block_stop') {
          const b = blocks.get(ev.index)
          if (b?.tool) {
            yield { kind: 'tool_use', call: { id: b.tool.id, name: b.tool.name, args: parseArgs(b.tool.json) } }
          }
        } else if (ev.type === 'message_start') {
          result.usage = readUsage(ev.message?.usage, result.usage)
        } else if (ev.type === 'message_delta') {
          if (ev.delta?.stop_reason) result.stopReason = ev.delta.stop_reason
          result.usage = readUsage(ev.usage, result.usage)
        } else if (ev.type === 'error') {
          throw new Error(ev.error?.message || 'Ошибка стрима')
        }
      }
    }
    const idx = [...blocks.keys()].sort((a, b) => a - b)
    for (const i of idx) {
      const b = blocks.get(i)
      if (b.type === 'text' && b.text) result.text += b.text
      if (b.type === 'thinking' && b.thinking) {
        result.thinkingBlocks.push({ thinking: b.thinking, signature: b.signature })
      }
    }
  } else {
    const acc = new Map()
    while (true) {
      const chunk = await nextChunk()
      if (chunk === null) break
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let ev
        try {
          ev = JSON.parse(data)
        } catch {
          continue
        }
        if (ev.error) throw new Error(ev.error.message || 'Ошибка стрима')
        if (ev.usage) result.usage = readUsage(ev.usage, result.usage)
        const ch = ev.choices?.[0]
        if (!ch) continue
        const d = ch.delta || {}
        if (d.reasoning_content) yield { kind: 'reasoning', value: d.reasoning_content }
        if (d.content) {
          result.text += d.content
          yield { kind: 'text', value: d.content }
        }
        for (const t of d.tool_calls || []) {
          const a = acc.get(t.index) || { id: '', name: '', args: '' }
          if (t.id) a.id = t.id
          if (t.function?.name) a.name = t.function.name
          if (t.function?.arguments) a.args += t.function.arguments
          acc.set(t.index, a)
        }
        if (ch.finish_reason) result.stopReason = ch.finish_reason
      }
    }
    const idx = [...acc.keys()].sort((a, b) => a - b)
    for (const i of idx) {
      const a = acc.get(i)
      yield { kind: 'tool_use', call: { id: a.id || 'call_' + i, name: a.name, args: parseArgs(a.args) } }
    }
  }

  return result
}

// Повторная проверка провайдера использует тот же безопасный сценарий обнаружения моделей.
export async function testConnection(provider) {
  await discoverProvider(provider)
  return true
}
