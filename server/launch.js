import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { publicInviteBase } from './invite.js'

const port = Number(process.env.PORT || 18890)
const origin = `http://127.0.0.1:${port}`
const args = process.argv.slice(2)
const openBrowser = args.includes('--browser')
const cloudflared = args.find(argument => argument !== '--browser') || 'cloudflared'
const children = new Set()
const lock = createServer(socket => socket.end())
let stopping = false

function start(command, commandArgs) {
  const child = spawn(command, commandArgs, { stdio: 'inherit', windowsHide: true })
  children.add(child)
  const done = new Promise(resolve => {
    child.once('error', error => resolve({ error }))
    child.once('exit', code => resolve({ code }))
  }).finally(() => children.delete(child))
  return { child, done }
}

function stop() {
  stopping = true
  for (const child of children) if (child.pid) child.kill()
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop)

function acquireLock() {
  // 用 Windows 命名管道协调双击启动，进程结束后系统自动释放。
  return new Promise((resolve, reject) => {
    lock.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error))
    lock.listen(`\\\\.\\pipe\\oped-party-launch-${port}`, () => resolve(true))
  })
}

async function isSiteReady() {
  try {
    const response = await fetch(`${origin}/api/access`, { signal: AbortSignal.timeout(500), redirect: 'error' })
    if (!response.ok) return false
    const access = await response.json()
    return access.host === true && access.direct === true && access.forwarded === false
  } catch {
    return false
  }
}

async function waitForSite(site) {
  for (let attempt = 0; attempt < 35 && !stopping; attempt++) {
    if (await isSiteReady()) return true
    if (site?.child.exitCode != null || site?.child.signalCode) break
    await delay(200)
  }
  return false
}

function showSite() {
  if (!openBrowser) return
  const browser = spawn('explorer.exe', [origin], { stdio: 'ignore', windowsHide: true })
  browser.on('error', () => console.log(`[oped-party] Open ${origin} in your browser.`))
  browser.unref()
}

async function launch() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  if (!await acquireLock()) {
    if (!await waitForSite()) throw new Error(`The other launcher did not start ${origin}`)
    showSite()
    console.log('[oped-party] An existing launcher is handling the site and tunnel.')
    return
  }

  const siteReady = await isSiteReady()
  if (stopping) return
  const site = siteReady ? null : start(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))])
  if (!await waitForSite(site)) {
    if (stopping) return
    throw new Error(`Cannot start the OP/ED site at ${origin}`)
  }
  showSite()

  const active = await publicInviteBase(port)
  if (stopping) return
  if (active) {
    console.log(`[oped-party] Reusing the connected public tunnel: ${active}`)
    lock.close()
  } else {
    console.log('[oped-party] Starting remote scoring. The Invite dialog will pick up the public address.')
    const tunnel = start(cloudflared, [
      'tunnel', '--protocol', process.env.TUNNEL_TRANSPORT_PROTOCOL || 'http2',
      '--url', origin, '--no-autoupdate'
    ])
    const result = await (site ? Promise.race([tunnel.done, site.done.then(() => null)]) : tunnel.done)
    if (!result || stopping) return
    lock.close()
    if (result.error?.code === 'ENOENT') {
      console.log('[oped-party] cloudflared is missing. Install it with: winget install --id Cloudflare.cloudflared')
    } else {
      console.log(`[oped-party] The public tunnel stopped (${result.error?.message ?? result.code ?? 'closed'}).`)
    }
    console.log(`[oped-party] Local use remains available at ${origin}.`)
    if (!site) process.exitCode = 1
  }

  if (site) await site.done
}

try {
  await launch()
} catch (error) {
  console.error('[oped-party]', error.message)
  process.exitCode = 1
} finally {
  stop()
  if (lock.listening) lock.close()
}
