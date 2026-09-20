// 给 v2.1.0 Release 说明顶部加便携版下载引导（用法：先 curl GET release 存 build/release-current.json 再跑本脚本）
import fs from 'node:fs'
const rel = JSON.parse(fs.readFileSync('build/release-current.json', 'utf-8'))
const head = [
  '## ⬇️ Windows 便携版（推荐，免安装）',
  '',
  '下载 `oped-party-v2.1.0-win64.zip`（约 192 MB，内含 Node 运行时与 cloudflared），',
  '解压后双击 `启动鉴赏会.bat` 即用；线上鉴赏会双击 `开远程打分.bat`。',
  '详情见压缩包内「使用说明.txt」。开发者可走下方源码方式。',
  '',
  '---',
  ''
].join('\n')
fs.writeFileSync('build/release-patch.json', JSON.stringify({ body: head + rel.body }), 'utf-8')
console.log('patch payload ready,', rel.body.length, 'chars original')
