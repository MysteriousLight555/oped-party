/**
 * 组装 Windows 便携版（免安装绿色包）：
 *   build/oped-party-v{ver}-win64.zip
 *     启动鉴赏会.bat / 开远程打分.bat / 使用说明.txt
 *     node\node.exe                 ← 官方运行时，免装 Node
 *     cloudflared\cloudflared.exe   ← 公网通道，免装 cloudflared
 *     app\（server + dist + 精简后的生产依赖）
 *
 * 前置：本机已装 cloudflared（复制用）。用法：node scripts/build-portable.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const VERSION = pkg.version
const OUT_DIR = path.join(ROOT, 'build', 'portable')
const BASE_DIR = path.join(OUT_DIR, 'oped-party')
const APP_DIR = path.join(BASE_DIR, 'app')
const ZIP_PATH = path.join(ROOT, 'build', `oped-party-v${VERSION}-win64.zip`)

const rmrf = p => fs.rmSync(p, { recursive: true, force: true })
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

console.log('[1/6] 构建前端（确保 dist 最新）')
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })

console.log('[2/6] 清空并搭建目录')
rmrf(OUT_DIR)
rmrf(ZIP_PATH)
fs.mkdirSync(APP_DIR, { recursive: true })

console.log('[3/6] 复制 server / dist')
copyDir(path.join(ROOT, 'server'), path.join(APP_DIR, 'server'))
copyDir(path.join(ROOT, 'dist'), path.join(APP_DIR, 'dist'))
// 最小 package.json：type:module 让 ES 模块跑起来；依赖交给下一步安装
fs.writeFileSync(
  path.join(APP_DIR, 'package.json'),
  JSON.stringify({ name: 'oped-party', private: true, type: 'module' }, null, 2)
)

console.log('[4/6] 安装生产依赖（临时目录内，不动开发仓库）')
// lock 里带 scripts/devDeps 元数据，直接复制原 package.json + lock 保证 npm ci 校验通过，
// 靠 --omit=dev 排除开发依赖；装完再剔除纯前端包（已构建进 dist，运行时用不到，省 60MB）
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP_DIR, 'package.json.orig'))
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP_DIR, 'package.json'))
fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(APP_DIR, 'package-lock.json'))
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: APP_DIR, stdio: 'inherit' })
rmrf(path.join(APP_DIR, 'package.json.orig'))
for (const name of ['element-plus', 'vue', 'vue-router']) {
  rmrf(path.join(APP_DIR, 'node_modules', name))
}

console.log('[5/6] 内嵌运行时：node.exe + cloudflared.exe')
fs.mkdirSync(path.join(BASE_DIR, 'node'), { recursive: true })
fs.mkdirSync(path.join(BASE_DIR, 'cloudflared'), { recursive: true })
fs.copyFileSync(process.execPath, path.join(BASE_DIR, 'node', 'node.exe'))
const CLOUDFLARED_SRC = 'C:/Program Files (x86)/cloudflared/cloudflared.exe'
if (!fs.existsSync(CLOUDFLARED_SRC)) {
  throw new Error('找不到 cloudflared.exe（' + CLOUDFLARED_SRC + '），先 winget install --id Cloudflare.cloudflared')
}
fs.copyFileSync(CLOUDFLARED_SRC, path.join(BASE_DIR, 'cloudflared', 'cloudflared.exe'))

console.log('[6/6] 复制启动脚本并压缩')
copyDir(path.join(ROOT, 'portable'), BASE_DIR)

const psCmd = `Compress-Archive -Path "${BASE_DIR.replaceAll('/', '\\')}\\*" -DestinationPath "${ZIP_PATH.replaceAll('/', '\\')}" -Force`
const r = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' })
if (r.status !== 0) throw new Error('压缩失败')

const size = fs.statSync(ZIP_PATH).size
console.log(`\n完成：${ZIP_PATH}（${(size / 1024 / 1024).toFixed(1)} MB）`)
