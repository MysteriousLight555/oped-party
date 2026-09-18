# OP/ED 鉴赏会 🎵

新番 OP/ED 鉴赏会的打分小工具：贴一个 B 站合集的 BV 号，自动拉取全部分 P，现场逐首打分（每人总分 + 可配置的维度分 + 收藏 + 短评 + 标签），结束后一键生成排行榜报告发群里。

## 使用（日常）

双击 **`启动鉴赏会.bat`**，浏览器打开 <http://127.0.0.1:18890> 即可。首次双击会自动安装依赖并构建（需要已装 Node.js LTS）。

一场鉴赏会的流程：

1. **设置页**：把同学（参与人）、打分维度（默认 编曲/vocal/画面，可增删、可隐藏）、标签库配好
2. **首页 → 新建一期**：贴 B 站分享链接（自动提取 BV 号），或手动粘贴曲目列表
3. **打分工作台**：左边是分 P 列表，中间给当前曲打分——输完一格按回车跳下一格，最后一个回车自动进下一首；行尾 ★ 收藏；支持短评、标签、跳过（菜单类分 P）
4. **报告**：工作台或期次卡片上一键「预览排行榜 / 下载 HTML / Markdown / Excel / JSON」；首页还有跨期的「全期总榜」（歌曲去重总榜、歌手榜、番剧榜、各期回顾）

数据全部存在 `data/` 目录（JSON 文件），备份就是复制这个目录。

## 开发

```bash
npm install
npm run dev        # Express(18890) + Vite(5175，/api 代理)
npm run build      # 构建前端到 dist/
npm start          # 只起后端（同时 serve dist）
npm run typecheck  # vue-tsc 类型检查
```

## 结构

```
server/           Express 后端
  index.js        API 路由 + 静态资源
  bili.js         B站视频信息/分P代理（带缓存，data/cache/）
  parse.js        分P标题解析（先行/正式OP·ED、【主题曲】等模式）
  store.js        config / sessions JSON 存取
  stats.js        榜单统计（单期 + 跨期聚合）
  report-*.js     HTML / Markdown / Excel 报告生成
src/              Vue3 + TS + Element Plus 前端
  views/HomeView.vue        期次列表 / 新建
  views/WorkbenchView.vue   打分工作台
  views/SettingsView.vue    参与人/维度/标签配置
data/             运行数据（gitignore）
```

## 说明

- B 站只调用公开的 `pagelist` / `view` 接口拉标题和时长，每期一次并缓存，无需登录；接口异常时可用「手动粘贴列表」导入，不耽误鉴赏会
- 分 P 标题解析是尽力而为（不同 UP 主格式不同），解析不对可在工作台「修正信息」里手动改
- 隐藏某个打分维度只是不显示，历史数据保留，随时可以再打开
