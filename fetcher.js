#!/usr/bin/env node
/**
 * AI Pulse 新闻预抓取脚本
 *
 * 功能：抓取所有厂商 RSS 源、Google News 聚合、GitHub Trending，
 *       解析 XML/RSS，智能评分，翻译标题，去重，输出 JSON 文件。
 *
 * 用法：
 *   node fetcher.js [--output ./news.json] [--verbose]
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// 命令行参数解析
// ============================================================
const args = process.argv.slice(2);
let outputPath = './news.json';
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (args[i] === '--verbose') {
    verbose = true;
  }
}

function log(...msgs) {
  console.log(`[${new Date().toISOString()}]`, ...msgs);
}

function vlog(...msgs) {
  if (verbose) console.log(`[${new Date().toISOString()}]`, ...msgs);
}

// ============================================================
// 厂商配置 (与 ai-news-hub.html 完全一致)
// ============================================================
const VENDORS = [
  { key:'openai',   name:'OpenAI',     color:'#10a37f', rss:'https://openai.com/news/rss.xml', init:'OA' },
  { key:'anthropic',name:'Anthropic',  color:'#c96442', rss:'https://www.anthropic.com/news.xml', init:'AN' },
  { key:'google',   name:'Google AI',  color:'#4285f4', rss:'https://blog.google/technology/ai/rss/', init:'G' },
  { key:'huggingface',name:'HuggingFace',color:'#ff9d00',rss:'https://huggingface.co/blog/feed.xml', init:'HF' },
  { key:'deepmind', name:'DeepMind',   color:'#00897b', rss:'https://deepmind.google/blog/rss.xml', init:'DM' },
  { key:'kimi',     name:'Kimi',       color:'#7c3aed', rss:null, init:'K' },
  { key:'qwen',     name:'Qwen',       color:'#615ced', rss:null, init:'Q' },
  { key:'deepseek', name:'DeepSeek',   color:'#1e40af', rss:null, init:'DS' },
  // 新增数据源
  { key:'arxiv',    name:'arXiv',      color:'#b31b1b', rss:'https://rss.arxiv.org/rss/cs.AI', init:'AX' },
  { key:'nvidia',   name:'NVIDIA',     color:'#76b900', rss:'https://blogs.nvidia.com/blog/tag/artificial-intelligence/feed/', init:'NV' },
  { key:'microsoft',name:'Microsoft',  color:'#0078d4', rss:'https://news.microsoft.com/en-in/tag/machine-learning/feed/', init:'MS' },
  { key:'techcrunch',name:'TechCrunch',color:'#0a9e01', rss:'https://techcrunch.com/category/artificial-intelligence/feed/', init:'TC' },
  { key:'venturebeat',name:'VentureBeat',color:'#ed1c24',rss:'https://venturebeat.com/category/ai/feed/', init:'VB' },
];

const VENDOR_MAP = {};
VENDORS.forEach(v => VENDOR_MAP[v.key] = v);

// ============================================================
// 分类关键词 (与 ai-news-hub.html 完全一致)
// ============================================================
const CAT_KEYWORDS = {
  Release: ['launch','release','announce','introducing','unveil','发布','推出','上线','available now'],
  Product: ['api','feature','update','app','chatgpt','claude','gemini','product','integration','功能','更新'],
  Research: ['paper','research','study','benchmark','论文','研究','arxiv','model'],
  Funding: ['funding','raise','investment','series','valuation','融资','估值','投资','ipo'],
  Agent: ['agent','agentic','tool use','autonomous','智能体','代理'],
  Safety: ['safety','alignment','security','risk','jailbreak','安全','对齐','风险'],
};

// ============================================================
// 评分系统常量 (与 ai-news-hub.html 完全一致)
// ============================================================
const SCORE_CATEGORY_WEIGHTS = { Release:25, Research:22, Funding:20, Product:15, Agent:12, Safety:10 };
const SCORE_SOURCE_TRUST = {
  openai:15, anthropic:15, google:15, deepmind:15, huggingface:14, arxiv:13,
  kimi:12, qwen:12, deepseek:12, nvidia:10, microsoft:10, techcrunch:8, venturebeat:8, github:10, other:5
};
const SCORE_KEYWORDS = {
  major: ['launch','release','announce','unveil','gpt-5','gpt-4','claude','gemini','kimi k','qwen','deepseek','foundation model','state-of-the-art','sota','breakthrough','open source','开源','发布','推出','重磅'],
  research: ['paper','arxiv','benchmark','novel','zero-shot','few-shot','multimodal','rlhf','transformer','diffusion','moe','mamba','long context','reasoning','chain of thought','论文','研究','评测'],
  funding: ['funding','raise','investment','series','valuation','billion','unicorn','ipo','acquisition','融资','估值','投资','收购','上市'],
  security: ['safety','security','breach','jailbreak','leak','vulnerability','alignment','red team','安全','泄露','漏洞','越狱']
};
const SCORE_ENTITY_RE = /(?:GPT|Claude|Gemini|Llama|Mistral|Qwen|DeepSeek|Kimi|Moonshot|ChatGPT|OpenAI|Anthropic|Google|Meta|Microsoft|Nvidia|Transformer|Diffusion|RLHF|MoE|Mamba)\b/gi;

// ============================================================
// 抓取配置
// ============================================================
const FETCH_TIMEOUT = 15000; // 每个源 15 秒超时
const TRANSLATION_DELAY = 200; // 翻译请求间隔 200ms
const MAX_TRANSLATION_PER_SEC = 5; // 每秒最多 5 个翻译请求

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 3,        // 最大重试次数
  baseDelay: 1000,      // 基础延迟（毫秒）
  backoffMultiplier: 2, // 指数退避倍数
  jitter: true,         // 是否添加随机抖动
};

// ============================================================
// 工具函数 (与 ai-news-hub.html 完全一致)
// ============================================================

function parseDate(str) {
  if (!str) return Date.now();
  const d = new Date(str);
  return isNaN(d) ? Date.now() : d.getTime();
}

function hashId(s) {
  return s.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0) + '';
}

function generateSummary(title, desc) {
  let text = desc || title;
  text = text.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/&#[0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > 200) text = text.slice(0, 200) + '\u2026';
  return text;
}

function classify(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  let best = 'Product', bestScore = 0;
  for (const [cat, kws] of Object.entries(CAT_KEYWORDS)) {
    let score = 0;
    kws.forEach(k => { if (text.includes(k.toLowerCase())) score++; });
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

function detectVendor(title, desc, sourceUrl) {
  const text = (title + ' ' + desc).toLowerCase();
  // 优先检测国产模型（避免被 Google/OpenAI 关键词抢占）
  if (/kimi|moonshot|月之暗面/i.test(text)) return 'kimi';
  if (/qwen|千问|通义/i.test(text)) return 'qwen';
  if (/deepseek|深度求索/i.test(text)) return 'deepseek';
  if (sourceUrl) {
    if (sourceUrl.includes('openai.com')) return 'openai';
    if (sourceUrl.includes('anthropic.com')) return 'anthropic';
    if (sourceUrl.includes('blog.google') || sourceUrl.includes('deepmind')) return 'google';
    if (sourceUrl.includes('huggingface.co')) return 'huggingface';
    if (sourceUrl.includes('arxiv.org')) return 'arxiv';
    if (sourceUrl.includes('blogs.nvidia.com') || sourceUrl.includes('nvidia.com')) return 'nvidia';
    if (sourceUrl.includes('microsoft.com')) return 'microsoft';
    if (sourceUrl.includes('techcrunch.com')) return 'techcrunch';
    if (sourceUrl.includes('venturebeat.com')) return 'venturebeat';
  }
  if (/openai|gpt|chatgpt|sam altman/i.test(text)) return 'openai';
  if (/anthropic|claude|sonnet|opus|haiku/i.test(text)) return 'anthropic';
  if (/google|gemini|deepmind|bard/i.test(text)) return 'google';
  if (/hugging|transformers|diffusers/i.test(text)) return 'huggingface';
  if (/nvidia|cuda|tensorrt|omniverse/i.test(text)) return 'nvidia';
  if (/microsoft|copilot|azure openai/i.test(text)) return 'microsoft';
  return 'other';
}

function assessImpact(title, desc, vendor) {
  const text = (title + ' ' + desc).toLowerCase();
  let score = 0;
  if (/launch|release|发布|推出|gpt-5|claude 5|gemini 3|kimi k|qwen[0-9]|deepseek v/i.test(text)) score += 2;
  if (/funding|billion|融资|估值|ipo|acquisition|收购/i.test(text)) score += 2;
  if (/safety|security|breach|jailbreak|leak|安全|泄露/i.test(text)) score += 1;
  if (/api|developer|platform|开放/i.test(text)) score += 1;
  if (vendor !== 'other') score += 1;
  if (score >= 3) return 'high';
  if (score >= 1) return 'med';
  return 'low';
}

function calculateNewsScore(item) {
  const title = (item.title || '').trim();
  const summary = (item.summary || '').trim();
  const raw = (item._rawContent || '').trim();
  const vendor = item.vendor || 'other';
  const category = item.category || 'Product';
  const pubDate = item.pubDate || 0;
  const text = (title + ' ' + summary + ' ' + raw).toLowerCase();

  // 1. 内容质量 (0-30)
  let cq = 0;
  const tLen = title.length;
  cq += tLen >= 40 && tLen <= 100 ? 6 : tLen >= 25 ? 4 : tLen >= 15 ? 2 : 1;
  const sLen = summary.length;
  cq += sLen >= 200 ? 8 : sLen >= 100 ? 6 : sLen >= 50 ? 4 : sLen >= 20 ? 2 : 0;
  if (raw) {
    const paras = raw.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    cq += paras.length >= 8 ? 10 : paras.length >= 5 ? 8 : paras.length >= 3 ? 6 : 4;
  } else {
    cq += sLen > 100 ? 4 : 1;
  }
  const entities = (text.match(SCORE_ENTITY_RE) || []).length;
  cq += entities >= 5 ? 6 : entities >= 3 ? 4 : entities >= 1 ? 2 : 0;
  cq = Math.min(cq, 30);

  // 2. 关键词价值 (0-20)
  let kv = 0;
  let ms = 0; SCORE_KEYWORDS.major.forEach(k => { if (text.includes(k)) ms += 2; }); ms = Math.min(ms, 8); kv += ms;
  let rs = 0; SCORE_KEYWORDS.research.forEach(k => { if (text.includes(k)) rs += 1; }); rs = Math.min(rs, 6); kv += rs;
  let fs = 0; SCORE_KEYWORDS.funding.forEach(k => { if (text.includes(k)) fs += 1; }); fs = Math.min(fs, 4); kv += fs;
  let ss = 0; SCORE_KEYWORDS.security.forEach(k => { if (text.includes(k)) ss += 0.5; }); ss = Math.min(ss, 2); kv += Math.round(ss);
  kv = Math.min(kv, 20);

  // 3. 类别权重 (0-25)
  const cw = SCORE_CATEGORY_WEIGHTS[category] || 10;

  // 4. 来源可信度 (0-15)
  const st = SCORE_SOURCE_TRUST[vendor] || 5;

  // 5. 时效性 (0-5)
  let rc = 0;
  if (pubDate) {
    const hrs = (Date.now() - pubDate) / 3600000;
    rc = hrs < 2 ? 5 : hrs < 6 ? 4 : hrs < 24 ? 3 : hrs < 48 ? 2 : hrs < 168 ? 1 : 0;
  }

  // 6. 交叉信号 (0-5)
  let cs = 0;
  if (item._multiSource) {
    const c = item._multiSource;
    cs = c >= 5 ? 5 : c >= 3 ? 4 : c >= 2 ? 3 : 1;
  }

  const total = Math.min(Math.round(cq + kv + cw + st + rc + cs), 100);
  return { score: total, breakdown: { cq, kv, cw, st, rc, cs } };
}

function batchScoreNews(items) {
  // 多源覆盖度
  const groups = {};
  items.forEach(n => {
    const k = (n.title || '').slice(0, 50).toLowerCase();
    if (!groups[k]) groups[k] = new Set();
    groups[k].add(n.vendor);
  });
  items.forEach(n => {
    const k = (n.title || '').slice(0, 50).toLowerCase();
    n._multiSource = groups[k] ? groups[k].size : 1;
    const r = calculateNewsScore(n);
    n.score = r.score;
    n.scoreBreakdown = r.breakdown;
  });
  return items;
}

// ============================================================
// RSS XML 解析器 (Node.js 版本，不依赖 DOMParser)
// ============================================================

function decodeHTMLEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (_, e) => {
      const entities = { 'nbsp':' ', 'mdash':'\u2014', 'ndash':'\u2013', 'lsquo':'\u2018', 'rsquo':'\u2019', 'ldquo':'\u201C', 'rdquo':'\u201D' };
      return entities[e.toLowerCase()] || _;
    });
}

function parseRSSXML(xmlText, vendorKey) {
  const items = [];
  // 使用正则匹配 <item>...</item> 块
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const cdMatch = block.match(re);
      if (cdMatch) return decodeHTMLEntities(cdMatch[1].trim());

      const re2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m2 = block.match(re2);
      if (m2) return decodeHTMLEntities(m2[1].trim());

      return '';
    };

    const title = getTag('title');
    if (!title) continue;

    const link = getTag('link');
    const pubDate = getTag('pubDate') || getTag('dc:date');
    const description = getTag('description');
    const content = getTag('content:encoded') || getTag('encoded');
    const creator = getTag('dc:creator') || getTag('author');
    const source = getTag('source');

    const fullDesc = content || description;

    items.push({
      id: hashId(title + link),
      title,
      summary: generateSummary(title, fullDesc),
      _rawContent: content || description || '',
      link,
      pubDate: parseDate(pubDate),
      vendor: vendorKey,
      category: classify(title, fullDesc),
      impact: assessImpact(title, fullDesc, vendorKey),
      source: VENDOR_MAP[vendorKey] ? VENDOR_MAP[vendorKey].name : vendorKey,
      author: creator,
      _sourceTag: source,
      read: false,
    });
  }

  return items;
}

// 解析 Atom Feed 格式
function parseAtomXML(xmlText, vendorKey) {
  const items = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const cdMatch = block.match(re);
      if (cdMatch) return decodeHTMLEntities(cdMatch[1].trim());

      const re2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m2 = block.match(re2);
      if (m2) return decodeHTMLEntities(m2[1].trim());

      return '';
    };

    const title = getTag('title');
    if (!title) continue;

    const linkEl = block.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i);
    const link = linkEl ? linkEl[1] : getTag('link');
    const pubDate = getTag('published') || getTag('updated') || getTag('pubDate');
    const summary = getTag('summary') || getTag('content') || getTag('description');
    const content = getTag('content');
    const author = getTag('author') || (block.match(/<author[^>]*><name[^>]*>([^<]+)<\/name>/i) || [])[1] || '';

    const fullDesc = content || summary;

    items.push({
      id: hashId(title + link),
      title,
      summary: generateSummary(title, fullDesc),
      _rawContent: content || summary || '',
      link,
      pubDate: parseDate(pubDate),
      vendor: vendorKey,
      category: classify(title, fullDesc),
      impact: assessImpact(title, fullDesc, vendorKey),
      source: VENDOR_MAP[vendorKey] ? VENDOR_MAP[vendorKey].name : vendorKey,
      author,
      read: false,
    });
  }

  return items;
}

function parseRSS(xmlText, vendorKey) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  // 检测是否为 Atom 格式
  if (xmlText.includes('<feed ') || xmlText.includes('<feed>') || xmlText.includes('xmlns="http://www.w3.org/2005/Atom"')) {
    return parseAtomXML(xmlText, vendorKey);
  }
  return parseRSSXML(xmlText, vendorKey);
}

// ============================================================
// 重试工具函数
// ============================================================

/**
 * 通用的重试执行函数，支持指数退避和随机抖动
 * @param {Function} fn - 异步函数
 * @param {Object} options - 重试选项
 * @param {number} options.maxRetries - 最大重试次数
 * @param {number} options.baseDelay - 基础延迟（毫秒）
 * @param {number} options.backoffMultiplier - 退避倍数
 * @param {boolean} options.jitter - 是否添加随机抖动
 * @param {string} options.name - 操作名称（用于日志）
 * @returns {Promise<any>}
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    baseDelay = RETRY_CONFIG.baseDelay,
    backoffMultiplier = RETRY_CONFIG.backoffMultiplier,
    jitter = RETRY_CONFIG.jitter,
    name = 'operation',
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        vlog(`  重试 ${name} (第 ${attempt}/${maxRetries} 次)`);
      }
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) {
        vlog(`  ${name}: 已用尽所有重试 (${maxRetries} 次) - ${error.message}`);
        throw error;
      }
      // 计算退避延迟
      let delay = baseDelay * Math.pow(backoffMultiplier, attempt);
      if (jitter) {
        delay = delay * (0.5 + Math.random()); // 添加 50%-150% 随机抖动
      }
      vlog(`  ${name} 失败: ${error.message}，${Math.round(delay)}ms 后重试 (${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================
// 代理 URL 构建
// ============================================================
const PROXIES = [
  u => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];

// ============================================================
// HTTP 请求工具
// ============================================================

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeout = FETCH_TIMEOUT) {
  const resp = await fetchWithTimeout(url, {}, timeout);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.url}`);
  return resp.text();
}

async function fetchJSON(url, timeout = FETCH_TIMEOUT) {
  const resp = await fetchWithTimeout(url, {}, timeout);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.url}`);
  return resp.json();
}

// ============================================================
// RSS 抓取：通过代理获取，先尝试 rss2json JSON API，再回退到 XML 解析
// ============================================================

async function fetchRSS(vendorKey) {
  const v = VENDOR_MAP[vendorKey];
  if (!v || !v.rss) return [];
  const rssUrl = v.rss;

  vlog(`抓取: ${v.name} (${rssUrl})`);

  // 尝试 rss2json API（带重试）
  try {
    const json = await retry(
      () => {
        const jsonUrl = PROXIES[0](rssUrl);
        return fetchJSON(jsonUrl);
      },
      { name: `rss2json/${v.name}`, maxRetries: 2 }
    );
    if (json && json.status === 'ok' && json.items) {
      const items = parseRSSJSON(json, vendorKey);
      vlog(`  ${v.name}: rss2json 返回 ${items.length} 条`);
      return items;
    }
  } catch (e) {
    vlog(`  ${v.name}: rss2json 失败 (${e.message}), 尝试 CORS 代理`);
  }

  // 回退：通过 CORS 代理获取原始 XML（每个代理尝试一次，失败换下一个，整体带重试）
  for (let i = 1; i < PROXIES.length; i++) {
    try {
      const proxyUrl = PROXIES[i](rssUrl);
      const xmlText = await retry(
        () => fetchText(proxyUrl),
        { name: `CORS#${i}/${v.name}`, maxRetries: 1 }
      );
      const items = parseRSS(xmlText, vendorKey);
      if (items.length > 0) {
        vlog(`  ${v.name}: CORS 代理 #${i} 返回 ${items.length} 条`);
        return items;
      }
    } catch (e) {
      vlog(`  ${v.name}: CORS 代理 #${i} 失败 (${e.message})`);
    }
  }

  vlog(`  ${v.name}: 所有代理均失败`);
  return [];
}

// rss2json JSON 格式解析
function parseRSSJSON(json, vendorKey) {
  if (!json || json.status !== 'ok' || !json.items) return [];
  return json.items.map(item => {
    const title = (item.title || '').trim();
    const desc = (item.description || '').trim();
    if (!title) return null;
    return {
      id: hashId(title + item.link),
      title,
      summary: generateSummary(title, desc),
      _rawContent: item.content || desc || '',
      link: item.link || '',
      pubDate: parseDate(item.pubDate),
      vendor: vendorKey,
      category: classify(title, desc),
      impact: assessImpact(title, desc, vendorKey),
      source: VENDOR_MAP[vendorKey] ? VENDOR_MAP[vendorKey].name : vendorKey,
      author: item.author || '',
      read: false,
    };
  }).filter(Boolean);
}

// ============================================================
// Google News 抓取
// ============================================================

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
  vlog(`抓取 Google News: ${query}`);

  // 尝试 rss2json（带重试）
  try {
    const json = await retry(
      () => {
        const jsonUrl = PROXIES[0](url);
        return fetchJSON(jsonUrl);
      },
      { name: `rss2json/GoogleNews[${query.slice(0, 20)}]`, maxRetries: 2 }
    );
    if (json && json.status === 'ok' && json.items) {
      const items = parseGoogleNewsJSON(json, query);
      vlog(`  Google News [${query}]: rss2json 返回 ${items.length} 条`);
      return items;
    }
  } catch (e) {
    vlog(`  Google News [${query}]: rss2json 失败 (${e.message}), 尝试 CORS 代理`);
  }

  // 回退：CORS 代理（每个代理重试1次）
  for (let i = 1; i < PROXIES.length; i++) {
    try {
      const proxyUrl = PROXIES[i](url);
      const xmlText = await retry(
        () => fetchText(proxyUrl),
        { name: `CORS#${i}/GoogleNews[${query.slice(0, 20)}]`, maxRetries: 1 }
      );
      const items = parseGoogleNewsXML(xmlText, query);
      if (items.length > 0) {
        vlog(`  Google News [${query}]: CORS 代理 #${i} 返回 ${items.length} 条`);
        return items;
      }
    } catch (e) {
      vlog(`  Google News [${query}]: CORS 代理 #${i} 失败 (${e.message})`);
    }
  }

  vlog(`  Google News [${query}]: 所有代理均失败`);
  return [];
}

function parseGoogleNewsXML(xmlText, query) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const cdMatch = block.match(re);
      if (cdMatch) return decodeHTMLEntities(cdMatch[1].trim());

      const re2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m2 = block.match(re2);
      if (m2) return decodeHTMLEntities(m2[1].trim());

      return '';
    };

    const title = getTag('title');
    const link = getTag('link');
    const pubDate = getTag('pubDate');
    const desc = getTag('description');

    if (!title) continue;

    const cleanTitle = title.replace(/\s*-\s*[^-]+$/, '').trim() || title;
    const vendor = detectVendor(cleanTitle, desc, '');
    if (vendor === 'other') continue;

    items.push({
      id: hashId(title + link),
      title: cleanTitle,
      summary: generateSummary(cleanTitle, desc),
      _rawContent: desc || '',
      link,
      pubDate: parseDate(pubDate),
      vendor,
      category: classify(cleanTitle, desc),
      impact: assessImpact(cleanTitle, desc, vendor),
      source: 'Google News',
      read: false,
    });
  }

  return items;
}

function parseGoogleNewsJSON(json, query) {
  if (!json || !json.items) return [];
  return json.items.map(item => {
    const title = (item.title || '').trim();
    const desc = (item.description || '').trim();
    if (!title) return null;
    const cleanTitle = title.replace(/\s*-\s*[^-]+$/, '').trim() || title;
    const vendor = detectVendor(cleanTitle, desc, '');
    if (vendor === 'other') return null;
    return {
      id: hashId(title + item.link),
      title: cleanTitle,
      summary: generateSummary(cleanTitle, desc),
      _rawContent: item.content || desc || '',
      link: item.link || '',
      pubDate: parseDate(item.pubDate),
      vendor,
      category: classify(cleanTitle, desc),
      impact: assessImpact(cleanTitle, desc, vendor),
      source: 'Google News',
      read: false,
    };
  }).filter(Boolean);
}

// ============================================================
// GitHub Trending 抓取
// ============================================================

async function fetchGitHubTrending() {
  vlog('抓取 GitHub Trending');

  const query = encodeURIComponent('topic:llm OR topic:transformer OR topic:machine-learning OR topic:ai stars:>=100 archived:false');
  const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=15`;

  try {
    const data = await retry(
      () => fetchJSON(url, 10000),
      { name: 'GitHub Trending', maxRetries: 2 }
    );
    if (!data.items) return [];

    const items = data.items.map(repo => ({
      id: hashId('gh:' + repo.full_name),
      title: repo.full_name,
      summary: (repo.description || 'No description') + ` \u00b7 \u2b50 ${(repo.stargazers_count || 0).toLocaleString('en-US')} stars \u00b7 ${repo.language || 'Unknown'}`,
      _rawContent: repo.description || '',
      link: repo.html_url,
      pubDate: new Date(repo.pushed_at || repo.updated_at).getTime(),
      vendor: 'github',
      category: 'Release',
      impact: (repo.stargazers_count || 0) > 10000 ? 'high' : (repo.stargazers_count || 0) > 1000 ? 'med' : 'low',
      source: 'GitHub Trending',
      read: false,
    }));

    vlog(`  GitHub Trending: ${items.length} 个仓库`);
    return items;
  } catch (e) {
    vlog(`  GitHub Trending: 失败 (${e.message})`);
    return [];
  }
}

// ============================================================
// 翻译
// ============================================================

const translationCache = new Map();

async function translateText(text, from = 'en', to = 'zh') {
  if (!text || typeof text !== 'string') return text;
  const key = `${from}|${to}:${text}`;
  if (translationCache.has(key)) return translationCache.get(key);

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const resp = await fetchWithTimeout(url, {}, 8000);
    const data = await resp.json();
    if (data && data.responseData && data.responseData.translatedText) {
      const translated = data.responseData.translatedText;
      if (translated.toLowerCase() !== text.toLowerCase()) {
        translationCache.set(key, translated);
        return translated;
      }
    }
  } catch (e) {
    vlog(`  翻译失败: ${text.slice(0, 50)}... (${e.message})`);
  }

  // 翻译失败返回原文
  translationCache.set(key, text);
  return text;
}

async function translateWithRateLimit(texts) {
  const results = [];
  let count = 0;

  for (const text of texts) {
    if (!text) {
      results.push(null);
      continue;
    }

    // 检查缓存
    const key = `en|zh:${text}`;
    if (translationCache.has(key)) {
      results.push(translationCache.get(key));
      continue;
    }

    // 速率限制：每秒最多 5 个请求
    if (count > 0 && count % MAX_TRANSLATION_PER_SEC === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const result = await translateText(text);
    results.push(result);
    count++;

    // 每次请求后延迟 200ms
    if (count % MAX_TRANSLATION_PER_SEC !== 0) {
      await new Promise(resolve => setTimeout(resolve, TRANSLATION_DELAY));
    }
  }

  return results;
}

// ============================================================
// 去重
// ============================================================

function deduplicate(items) {
  const seen = new Set();
  return items.filter(n => {
    const key = (n.title || '').slice(0, 100).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const startTime = Date.now();
  log('AI Pulse 新闻预抓取开始');

  let allNews = [];
  let sourceCount = 0;
  let fetchErrors = [];

  // 收集所有抓取任务
  const fetchTasks = [];

  // 1. 官方 RSS 源
  VENDORS.filter(v => v.rss).forEach(v => {
    fetchTasks.push(
      fetchRSS(v.key).catch(err => {
        fetchErrors.push({ source: v.name, error: err.message });
        return [];
      })
    );
  });

  // 2. Google News 聚合
  fetchTasks.push(
    fetchGoogleNews('Kimi Moonshot AI').catch(err => {
      fetchErrors.push({ source: 'Google News [Kimi]', error: err.message });
      return [];
    })
  );
  fetchTasks.push(
    fetchGoogleNews('Qwen Alibaba model').catch(err => {
      fetchErrors.push({ source: 'Google News [Qwen]', error: err.message });
      return [];
    })
  );
  fetchTasks.push(
    fetchGoogleNews('DeepSeek AI model').catch(err => {
      fetchErrors.push({ source: 'Google News [DeepSeek]', error: err.message });
      return [];
    })
  );

  // 3. GitHub Trending
  fetchTasks.push(
    fetchGitHubTrending().catch(err => {
      fetchErrors.push({ source: 'GitHub Trending', error: err.message });
      return [];
    })
  );

  // 并行执行所有抓取
  const results = await Promise.all(fetchTasks);

  // 合并结果
  results.forEach(r => {
    if (r && r.length > 0) {
      allNews = allNews.concat(r);
      sourceCount++;
    }
  });

  // 记录错误摘要
  if (fetchErrors.length > 0) {
    log(`警告: ${fetchErrors.length} 个源抓取失败:`);
    fetchErrors.forEach(e => vlog(`  - ${e.source}: ${e.error}`));
  }

  vlog(`合并后共 ${allNews.length} 条 (来自 ${sourceCount} 个源)`);

  if (allNews.length === 0) {
    log('错误: 所有源均未返回数据，检查网络连接和代理配置');
    // 不退出，仍然写入空文件以保持工作流连续性
  }

  // 去重
  allNews = deduplicate(allNews);
  vlog(`去重后共 ${allNews.length} 条`);

  // 排序
  allNews.sort((a, b) => b.pubDate - a.pubDate);

  // 智能评分
  batchScoreNews(allNews);
  log(`评分完成，共 ${allNews.length} 条`);

  // 翻译标题（只翻译英文标题）
  log('开始翻译标题...');
  const titlesToTranslate = [];
  const titleIndices = [];

  allNews.forEach((item, idx) => {
    if (item.title && /^[\x00-\x7F\s]+$/.test(item.title)) {
      titlesToTranslate.push(item.title);
      titleIndices.push(idx);
    }
  });

  vlog(`需要翻译 ${titlesToTranslate.length} 个标题`);

  if (titlesToTranslate.length > 0) {
    try {
      const translated = await translateWithRateLimit(titlesToTranslate);
      translated.forEach((t, i) => {
        if (t && t !== titlesToTranslate[i]) {
          allNews[titleIndices[i]].titleZh = t;
        } else {
          allNews[titleIndices[i]].titleZh = titlesToTranslate[i];
        }
      });
    } catch (e) {
      log(`翻译过程出错: ${e.message}，将使用原始标题`);
      // 翻译失败不阻塞流程，使用原始标题
      titleIndices.forEach(i => {
        allNews[i].titleZh = allNews[i].title;
      });
    }
  }

  log('翻译完成');

  // 构建输出
  const output = {
    updated: new Date().toISOString(),
    count: allNews.length,
    sources: sourceCount,
    items: allNews.map(item => ({
      id: item.id,
      title: item.title,
      titleZh: item.titleZh || item.title,
      summary: item.summary,
      link: item.link,
      pubDate: item.pubDate,
      vendor: item.vendor,
      category: item.category,
      impact: item.impact,
      score: item.score,
      scoreBreakdown: item.scoreBreakdown,
      source: item.source,
    })),
  };

  // 写入文件
  const absOutputPath = path.resolve(outputPath);
  // 确保输出目录存在
  const dir = path.dirname(absOutputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    fs.writeFileSync(absOutputPath, JSON.stringify(output, null, 2), 'utf-8');
  } catch (e) {
    log(`写入输出文件失败: ${e.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`输出: ${absOutputPath}`);
  log(`完成! ${output.count} 条新闻, ${output.sources} 个源, 耗时 ${elapsed}s`);
}

main().catch(err => {
  console.error('[FATAL] 新闻抓取脚本异常终止:', err.message);
  console.error(err.stack);
  process.exit(1);
});
