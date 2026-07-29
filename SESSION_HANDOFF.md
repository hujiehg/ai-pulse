# AI Pulse 项目交接文档（新会话上下文恢复）

> 本文档用于在新会话中快速恢复项目上下文。复制以下全部内容作为新会话的第一条消息即可。

---

## 项目概述

**AI Pulse · 前沿资讯中心** — 一个纯前端（零后端依赖）的 AI 行业新闻聚合仪表盘，采用微软 Fluent Design 风格，追踪 OpenAI、Anthropic、Google、DeepMind、Kimi、Qwen、DeepSeek 等 20+ AI 厂商和研究机构的最新动态。

核心特色：
- 三栏布局（厂商筛选 / 资讯流 / 趋势图表），各栏独立滚动
- 点击新闻弹出"科普博主风格"中文深度摘要（非简单翻译，而是模板化生成的技术解读）
- AI 智能评分系统（6 维度加权：时效性、来源可信度、分类权重、关键词热度、实体识别、影响力）
- 双语标题切换（译文/双语/原文）、暗色模式、时间窗口过滤、收藏与已读历史
- GitHub Actions 每 30 分钟预抓取数据，部署到 GitHub Pages
- 客户端 RSS 聚合作为 fallback（多 CORS 代理竞速）

---

## 文件结构

```
/workspace/
├── ai-news-hub.html          # 主文件（约 3100 行，含全部 CSS+JS）
├── deploy/
│   └── index.html            # 部署副本（需与主文件保持同步）
├── fetcher.js                # Node.js 新闻预抓取脚本（GitHub Actions 调用）
├── .github/workflows/
│   └── fetch-news.yml        # GitHub Actions 工作流（每 30 分钟运行）
├── package.json              # fetcher.js 的依赖
├── deploy.sh                 # 部署脚本
├── nexus-pwa/                # PWA 版本（实验性）
└── 其他 dashboard-*.html      # 早期原型（已废弃）
```

---

## 关键配置

### 数据源
- **预抓取 JSON**：`https://hujiehg.github.io/ai-pulse/news.json`（GitHub Actions 每 30 分钟更新）
- **JSON 过期阈值**：30 分钟后触发客户端实时抓取
- **RSS 缓存 TTL**：10 分钟（localStorage）
- **自动刷新间隔**：15 分钟

### CORS 代理（竞速模式）
```javascript
const PROXIES = [
  u => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];
const PROXY_TIMEOUT = 8000;
```

### 厂商列表（20 个）
openai, anthropic, google, huggingface, deepmind, kimi, qwen, deepseek, arxiv, nvidia, microsoft, techcrunch, venturebeat, hackernews, reddit_ml, devto, arxiv_cl, arxiv_cv, jiqizhixin(机器之心), liangziwei(量子位)

其中 kimi、qwen、deepseek、jiqizhixin、liangziwei 的 RSS 为 null，通过 Google News 聚合获取。

---

## 布局与滚动（最近修复的重点）

### CSS 布局结构
```css
html, body { height: 100%; overflow: hidden }
body { display: flex; flex-direction: column }

.main { overflow: hidden; flex: 1; min-height: 0 }
.grid { display: flex; align-items: stretch; height: 100% }

.left-panel  { width: 280px; height: 100%; overflow-y: auto; overscroll-behavior: contain }
.grid > section { flex: 1; height: 100%; overflow-y: auto; overscroll-behavior: contain }
.right-panel { width: var(--rpw, 320px); height: 100%; overflow-y: auto; overscroll-behavior: contain }
```

### JS hover 独占滚轮（文件末尾 initHoverScroll）
- 每个面板监听 `wheel` 事件
- 内容超出容器时拦截滚轮，`preventDefault` + `stopPropagation`
- 到达边界后仍阻止冒泡，防止滚动链传递到其他面板

### 可拖拽调整宽度
- 主面板：`#panelResizer` 拖拽调整右侧面板宽度（240px ~ 520px），localStorage 持久化
- 详情弹窗：`#modalResizer` 拖拽调整文章详情弹窗宽度（400px ~ 90vw），localStorage 持久化

---

## 核心函数索引

| 函数 | 行号(约) | 作用 |
|------|---------|------|
| `translateText()` | 933 | MyMemory API 翻译 + 词典 fallback |
| `batchTranslateNews()` | 981 | 批量翻译（并发 6） |
| `detectVendor()` | 1040 | 根据标题/描述/来源 URL 识别厂商 |
| `classify()` | 1030 | 根据 CAT_KEYWORDS 分类新闻 |
| `calculateNewsScore()` | 1101 | AI 智能评分（6 维度） |
| `generateAISummary()` | — | 科普博主风格摘要生成（ANALYSIS_TEMPLATES） |
| `parseRSS()` | 1232 | 解析 RSS XML |
| `parseGoogleNews()` | 1263 | 解析 Google News RSS |
| `fetchWithProxies()` | 1296 | 多代理竞速获取 RSS |
| `fetchAllNews()` | 1477 | 主入口：先 JSON → fallback RSS |
| `renderAll()` | — | 渲染所有 UI |
| `openArticle()` | 1975 | 打开文章详情弹窗 |
| `initResizer()` | 2943 | 主面板拖拽 |
| `initModalResizer()` | 3009 | 弹窗拖拽 |
| `initHoverScroll()` | 3097 | hover 独占滚轮 |

---

## 部署信息

- **GitHub 仓库**：`hujiehg/ai-pulse`（用户名 hujiehg）
- **GitHub Pages**：`https://hujiehg.github.io/ai-pulse/`（news.json 数据源）
- **Netlify**：曾使用 Netlify 部署（token: `nfp_Gyi2DQC98K8Fi6GdLciPyFdaxKnzY6qEcd79`）
- **本地预览**：`cd /workspace && python3 -m http.server 8765` → `http://localhost:8765/ai-news-hub.html`

---

## 注意事项

1. **两个 HTML 文件需同步**：`ai-news-hub.html` 是主开发文件，`deploy/index.html` 是部署副本。每次修改主文件后必须同步 deploy 版本，否则部署链接看不到更新。
2. **deploy/index.html 曾是旧版本**：之前的会话中发现 deploy 版本的 CSS 落后于主文件（缺少独立滚动样式），现已修复但未来修改需注意同步。
3. **GitHub Actions 依赖**：`fetcher.js` 中的 VENDORS 数组必须与 `ai-news-hub.html` 中的完全一致。
4. **科普摘要模板**：`ANALYSIS_TEMPLATES` 对象按厂商存储了 intro/tech/impact/summary 模板数组，随机组合生成摘要。
5. **翻译限流**：MyMemory API 有每日请求限制，已实现 localStorage 缓存 + 词典 fallback。
