#!/usr/bin/env node
// Evaluates a JavaScript expression in the GymTracker WebView over the Chrome DevTools Protocol.
// No dependencies: Node >= 22 (global fetch + WebSocket). Used by scripts/android/smoke.sh.
//
//   PID=$(adb shell pidof io.github.monniale.gymtracker.debug)
//   adb forward tcp:9333 localabstract:webview_devtools_remote_$PID
//   node scripts/android/cdp-eval.mjs 'location.origin'                       # → "https://localhost"
//   node scripts/android/cdp-eval.mjs --raw 'location.hash'                   # → #/workout (no quotes)
//   node scripts/android/cdp-eval.mjs --wait 8000 'location.hash === "#/diet"'
//
// The expression may return a promise (it is awaited); the value is printed as JSON (strings
// unquoted with --raw; undefined prints as null).
// Options:
//   --port N      DevTools port forwarded by adb (default $CDP_PORT or 9333)
//   --wait MS     re-evaluate until the value is truthy (survives page reloads); exit 1 on timeout
//   --interval MS polling interval for --wait (default 200)
//   --timeout MS  limit for one evaluation (default 15000; a JS dialog would otherwise hang it)
//   --raw         print a string result without JSON quotes
// Exit codes: 0 ok · 1 --wait timed out · 2 no WebView target / connection failed · 3 the expression threw.
// Only debug builds (or a release built with CAP_WEBVIEW_DEBUG=1) expose the DevTools socket.

const args = process.argv.slice(2)
const opt = { port: Number(process.env.CDP_PORT ?? 9333), wait: 0, interval: 200, timeout: 15000, raw: false }
let expr
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--raw') opt.raw = true
  else if (a === '--port' || a === '--wait' || a === '--interval' || a === '--timeout') opt[a.slice(2)] = Number(args[++i])
  else if (expr === undefined) expr = a
  else fail(2, `unexpected argument: ${a}`)
}
if (!expr) fail(2, 'usage: cdp-eval.mjs [--port N] [--wait MS] [--interval MS] [--timeout MS] [--raw] <expression>')
for (const k of ['port', 'wait', 'interval', 'timeout']) if (!Number.isFinite(opt[k])) fail(2, `--${k} needs a number`)

function fail(code, msg) {
  console.error(`cdp-eval: ${msg}`)
  process.exit(code)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

class ExprError extends Error {}

/** The app page: https://localhost (Capacitor origin), else the first page target. */
async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${opt.port}/json/list`, { signal: AbortSignal.timeout(5000) })
  const targets = await res.json()
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)
  return pages.find(t => t.url.startsWith('https://localhost')) ?? pages[0] ?? null
}

class Session {
  static async open() {
    const t = await pageTarget()
    if (!t) throw new Error(`no page target on port ${opt.port}`)
    const ws = new WebSocket(t.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true })
    })
    return new Session(ws)
  }

  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.closed = false
    ws.addEventListener('message', ev => {
      const m = JSON.parse(String(ev.data))
      const p = m.id !== undefined && this.pending.get(m.id)
      if (p) {
        this.pending.delete(m.id)
        p.resolve(m)
      }
    })
    ws.addEventListener('close', () => {
      this.closed = true
      for (const p of this.pending.values()) p.reject(new Error('WebSocket closed'))
      this.pending.clear()
    })
  }

  send(method, params) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${opt.timeout} ms`))
      }, opt.timeout)
      this.pending.set(id, {
        resolve: m => (clearTimeout(timer), resolve(m)),
        reject: e => (clearTimeout(timer), reject(e)),
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const m = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (m.error) throw new Error(`CDP error: ${m.error.message}`)
    const { result, exceptionDetails } = m.result
    if (exceptionDetails) {
      const desc = exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'exception'
      // A navigation/reload in progress is transient: let --wait retry it.
      if (/context was destroyed|Cannot find context|Inspected target navigated/i.test(desc)) throw new Error(desc)
      throw new ExprError(desc)
    }
    return result.value
  }

  close() {
    if (!this.closed) this.ws.close()
  }
}

function print(v) {
  if (opt.raw && typeof v === 'string') console.log(v)
  else console.log(JSON.stringify(v ?? null))
}

if (!opt.wait) {
  let s
  try {
    s = await Session.open()
  } catch (e) {
    fail(2, e.message)
  }
  try {
    print(await s.evaluate(expr))
    s.close()
    process.exit(0)
  } catch (e) {
    s.close()
    fail(e instanceof ExprError ? 3 : 2, e.message)
  }
}

// --wait: poll until truthy; reconnect across reloads; a throwing expression counts as "not yet".
const deadline = Date.now() + opt.wait
let session = null
let last
let lastErr = ''
for (;;) {
  try {
    session ??= await Session.open()
    last = await session.evaluate(expr)
    lastErr = ''
    if (last) {
      print(last)
      session.close()
      process.exit(0)
    }
  } catch (e) {
    lastErr = e.message
    if (!(e instanceof ExprError)) {
      session?.close()
      session = null
    }
  }
  if (Date.now() >= deadline) break
  await sleep(opt.interval)
}
session?.close()
print(last)
if (lastErr) console.error(`cdp-eval: last error: ${lastErr}`)
process.exit(1)
