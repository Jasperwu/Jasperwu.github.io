/* Foresight Oracle — client-side engine
 * Data:  Polymarket Gamma API (public, CORS-enabled, no auth)
 * Brain: Anthropic Claude API (direct browser access, BYOK)
 * No backend. The API key lives only in this browser's localStorage.
 */

(() => {
  'use strict';

  const LS_KEY = 'oracle_api_key';
  const LS_MODEL = 'oracle_model';
  const LS_WEBSEARCH = 'oracle_websearch';
  const GAMMA = 'https://gamma-api.polymarket.com/markets';
  const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';
  const HN = 'https://hn.algolia.com/api/v1/search_by_date';
  const WIKI_SEARCH = 'https://en.wikipedia.org/w/api.php';
  const WIKI_VIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents';
  const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

  const $ = (id) => document.getElementById(id);

  const el = {
    askForm: $('askForm'),
    keyword: $('keyword'),
    chips: $('suggestChips'),
    byokNote: $('byokNote'),
    stageInput: $('stage-input'),
    stageResults: $('stage-results'),
    overlay: $('oracleOverlay'),
    status: $('oracleStatus'),
    sub: $('oracleSub'),
    particles: $('particles'),
    resultTopic: $('resultTopic'),
    resultSummary: $('resultSummary'),
    resetBtn: $('resetBtn'),
    signals: $('signalsStrip'),
    horizons: $('horizons'),
    wildcardBox: $('wildcardBox'),
    wildcardText: $('wildcardText'),
    marketSource: $('marketSource'),
    marketList: $('marketList'),
    newsCard: $('newsCard'),
    newsList: $('newsList'),
    buzzCard: $('buzzCard'),
    buzzList: $('buzzList'),
    wikiCard: $('wikiCard'),
    wikiBody: $('wikiBody'),
    claudeSources: $('claudeSources'),
    // modal
    openSettings: $('openSettings'),
    modalBackdrop: $('modalBackdrop'),
    apiKeyInput: $('apiKeyInput'),
    modelSelect: $('modelSelect'),
    webSearchToggle: $('webSearchToggle'),
    saveKey: $('saveKey'),
    clearKey: $('clearKey'),
  };

  /* ---------- key storage ---------- */
  const getKey = () => localStorage.getItem(LS_KEY) || '';
  const getModel = () => localStorage.getItem(LS_MODEL) || 'claude-sonnet-4-6';
  const getWebSearch = () => localStorage.getItem(LS_WEBSEARCH) !== '0';

  function refreshByokNote() {
    if (getKey()) {
      el.byokNote.textContent = '✓ 金鑰已就緒，存在本機瀏覽器。可以開始預言。';
      el.byokNote.classList.add('ok');
    } else {
      el.byokNote.textContent = '尚未設定金鑰 — 點右上角「設定金鑰」貼上你的 Anthropic API key（只存在本機瀏覽器）。';
      el.byokNote.classList.remove('ok');
    }
  }

  /* ---------- modal ---------- */
  function openModal() {
    el.apiKeyInput.value = getKey();
    el.modelSelect.value = getModel();
    el.webSearchToggle.checked = getWebSearch();
    el.modalBackdrop.hidden = false;
  }
  function closeModal() { el.modalBackdrop.hidden = true; }

  el.openSettings.addEventListener('click', openModal);
  el.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === el.modalBackdrop) closeModal();
  });
  el.saveKey.addEventListener('click', () => {
    const k = el.apiKeyInput.value.trim();
    if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY);
    localStorage.setItem(LS_MODEL, el.modelSelect.value);
    localStorage.setItem(LS_WEBSEARCH, el.webSearchToggle.checked ? '1' : '0');
    refreshByokNote();
    closeModal();
  });
  el.clearKey.addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    el.apiKeyInput.value = '';
    refreshByokNote();
  });

  /* ---------- chips ---------- */
  el.chips.addEventListener('click', (e) => {
    if (e.target.classList.contains('chip')) {
      el.keyword.value = e.target.textContent;
      el.keyword.focus();
    }
  });

  /* ---------- particles for the orb ---------- */
  function seedParticles() {
    if (el.particles.childElementCount) return;
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = (10 + Math.random() * 80) + '%';
      p.style.bottom = (60 + Math.random() * 40) + 'px';
      p.style.animationDuration = (2.5 + Math.random() * 3) + 's';
      p.style.animationDelay = (Math.random() * 3) + 's';
      el.particles.appendChild(p);
    }
  }

  /* ---------- status cycling ---------- */
  const STATUS_STEPS = [
    ['正在召喚神諭…', '凝視水晶球'],
    ['爬取過去 3 天的事件…', 'GDELT 全球新聞'],
    ['聆聽社群的低語…', 'Hacker News 討論 · Wikipedia 關注度'],
    ['讀取市場的賠率…', 'Polymarket 即時機率'],
    ['以 futurist 之眼推演…', 'Claude 自主上網查證中'],
    ['編織可能的未來…', '對齊 3–18 個月的時間錐'],
  ];
  let statusTimer = null;
  function startStatusCycle() {
    let i = 0;
    const apply = () => {
      el.status.style.opacity = 0;
      setTimeout(() => {
        el.status.textContent = STATUS_STEPS[i][0];
        el.sub.textContent = STATUS_STEPS[i][1];
        el.status.style.opacity = 1;
        i = (i + 1) % STATUS_STEPS.length;
      }, 350);
    };
    apply();
    statusTimer = setInterval(apply, 2200);
  }
  function stopStatusCycle() { clearInterval(statusTimer); statusTimer = null; }

  /* ---------- Polymarket ---------- */
  function parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
    return [];
  }

  async function fetchMarkets(keyword) {
    const url = `${GAMMA}?closed=false&active=true&limit=250&order=volumeNum&ascending=false`;
    let raw;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      raw = await res.json();
    } catch { return []; }
    if (!Array.isArray(raw)) return [];

    const tokens = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = raw.filter((m) => {
      const q = (m.question || '').toLowerCase();
      return tokens.some((t) => q.includes(t)) || q.includes(keyword.toLowerCase());
    });

    return matches.slice(0, 6).map((m) => {
      const outcomes = parseList(m.outcomes);
      const prices = parseList(m.outcomePrices).map(Number);
      let yesIdx = outcomes.findIndex((o) => /yes/i.test(o));
      if (yesIdx < 0) yesIdx = 0;
      const prob = prices[yesIdx];
      return {
        question: m.question,
        prob: isFinite(prob) ? prob : null,
        outcome: outcomes[yesIdx] || 'Yes',
        volume: Number(m.volumeNum || m.volume || 0),
        endDate: m.endDate || null,
      };
    });
  }

  /* ---------- GDELT: last 3 days of global news ---------- */
  async function fetchGdelt(keyword) {
    // multi-word queries must be quoted for GDELT phrase search
    const q = /\s/.test(keyword.trim()) ? `"${keyword.trim()}"` : keyword.trim();
    const url = `${GDELT}?query=${encodeURIComponent(q)}&mode=ArtList&timespan=3d` +
                `&sort=DateDesc&maxrecords=20&format=json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const text = await res.text();
      if (!text.trim().startsWith('{')) return []; // GDELT returns plain-text errors
      const data = JSON.parse(text);
      const seen = new Set();
      return (data.articles || []).filter((a) => {
        if (seen.has(a.title)) return false;
        seen.add(a.title);
        return true;
      }).slice(0, 8).map((a) => ({
        title: a.title,
        url: a.url,
        domain: a.domain,
        date: a.seendate, // e.g. 20260525T120000Z
      }));
    } catch { return []; }
  }

  /* ---------- Hacker News: recent community discussion ---------- */
  async function fetchHN(keyword) {
    const since = Math.floor(Date.now() / 1000) - 3 * 86400;
    const build = (recencyFilter) =>
      `${HN}?query=${encodeURIComponent(keyword)}&tags=story` +
      (recencyFilter ? `&numericFilters=created_at_i>${since}` : '') +
      `&hitsPerPage=8`;
    try {
      let res = await fetch(build(true));
      let data = res.ok ? await res.json() : { hits: [] };
      if (!data.hits || !data.hits.length) { // widen if last 3d is empty
        res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=6`);
        data = res.ok ? await res.json() : { hits: [] };
      }
      return (data.hits || []).filter((h) => h.title).slice(0, 6).map((h) => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        points: h.points || 0,
        comments: h.num_comments || 0,
        date: (h.created_at_i || 0) * 1000,
      }));
    } catch { return []; }
  }

  /* ---------- Wikipedia: 30-day attention trend ---------- */
  function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
  async function fetchWikiTrend(keyword) {
    try {
      const sres = await fetch(`${WIKI_SEARCH}?action=opensearch&search=${encodeURIComponent(keyword)}&limit=1&namespace=0&format=json&origin=*`);
      if (!sres.ok) return null;
      const s = await sres.json();
      const title = (s[1] || [])[0];
      const pageUrl = (s[3] || [])[0];
      if (!title) return null;

      const end = new Date(Date.now() - 86400000);  // yesterday (today often incomplete)
      const start = new Date(end.getTime() - 29 * 86400000);
      const article = encodeURIComponent(title.replace(/ /g, '_'));
      const vres = await fetch(`${WIKI_VIEWS}/${article}/daily/${ymd(start)}/${ymd(end)}`);
      if (!vres.ok) return null;
      const v = await vres.json();
      const series = (v.items || []).map((i) => i.views);
      if (series.length < 6) return null;

      const half = Math.floor(series.length / 2);
      const recent = series.slice(half).reduce((a, b) => a + b, 0);
      const prior = series.slice(0, half).reduce((a, b) => a + b, 0) || 1;
      const change = Math.round(((recent - prior) / prior) * 100);
      return {
        title, pageUrl, series, change,
        total: series.reduce((a, b) => a + b, 0),
      };
    } catch { return null; }
  }

  /* ---------- helpers ---------- */
  function relTime(ms) {
    const diff = Date.now() - ms;
    const h = Math.floor(diff / 3600000);
    if (h < 1) return '剛剛';
    if (h < 24) return `${h} 小時前`;
    return `${Math.floor(h / 24)} 天前`;
  }
  function gdeltDate(s) {
    // 20260525T120000Z -> ms
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
    if (!m) return Date.now();
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  /* ---------- Claude ---------- */
  function buildPrompt(keyword, sig) {
    const { markets, news, buzz, wiki } = sig;
    const mkt = markets.length
      ? markets.map((m) =>
          `- "${m.question}" → ${m.outcome} ${m.prob != null ? Math.round(m.prob * 100) + '%' : 'n/a'}` +
          ` (成交量 $${Math.round(m.volume).toLocaleString()}` +
          `${m.endDate ? '，到期 ' + m.endDate.slice(0, 10) : ''})`
        ).join('\n')
      : '（無直接相關的 Polymarket 市場）';

    const newsBlock = news.length
      ? news.map((n) => `- ${n.title}（${n.domain}）`).join('\n')
      : '（過去 3 天 GDELT 無相關新聞）';

    const buzzBlock = buzz.length
      ? buzz.map((b) => `- ${b.title}（👍${b.points} 💬${b.comments}）`).join('\n')
      : '（Hacker News 無近期相關討論）';

    const wikiBlock = wiki
      ? `維基百科「${wiki.title}」過去 30 天瀏覽量 ${wiki.total.toLocaleString()}，` +
        `近期相對前期${wiki.change >= 0 ? '上升' : '下降'} ${Math.abs(wiki.change)}%（關注度${wiki.change >= 10 ? '升溫' : wiki.change <= -10 ? '降溫' : '持平'}）。`
      : '（無維基百科關注度資料）';

    return `關鍵詞：「${keyword}」

【Polymarket 預測市場即時賠率】
${mkt}

【過去 3 天全球新聞 · GDELT】
${newsBlock}

【Hacker News 社群討論】
${buzzBlock}

【Wikipedia 關注度趨勢】
${wikiBlock}

請以一位敏銳的 futurist 角色，整合上述「預測市場機率」「過去 3 天新聞事件」「社群討論熱度」「關注度趨勢」，並善用你的 web search 工具查證或補充最新發展，推演這個主題在未來 18 個月如何展開。drivers 與 rationale 請盡量引用上述真實數據或你查到的事實。

務必只回傳符合下列結構的有效 JSON（不要 markdown、不要程式碼框、不要多餘文字），全部欄位以繁體中文撰寫：
{
  "topic": "精煉後的主題（簡短）",
  "summary": "一句富畫面感的總綱預言",
  "drivers": ["驅動訊號1", "驅動訊號2", "驅動訊號3", "驅動訊號4"],
  "horizons": [
    {
      "range": "3–6 個月",
      "headline": "這個區段的標題",
      "events": [
        {"title": "可能事件", "likelihood": "probable|plausible|possible", "rationale": "簡短依據（可引用上面的市場機率或訊號）"}
      ]
    },
    { "range": "6–12 個月", "headline": "...", "events": [ ... ] },
    { "range": "12–18 個月", "headline": "...", "events": [ ... ] }
  ],
  "wildcard": "一個低機率但高衝擊的黑天鵝情境"
}

每個 horizon 請給 2–3 個 events。likelihood 只能是 probable、plausible、possible 三者之一，越近期的、越有市場/訊號支撐的越偏 probable。`;
  }

  function extractJSON(text) {
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(t); } catch {}
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new Error('無法解析神諭回傳的格式');
  }

  async function askClaude(keyword, sig) {
    const body = {
      model: getModel(),
      max_tokens: 3000,
      system: '你是一位頂尖的未來學家（futurist），擅長把預測市場數據、社群訊號與趨勢轉化為具體、可信、富洞察力的未來情境。語氣冷靜、精準、帶一點神諭的詩意。你的最終回覆必須「只」包含使用者要求的 JSON 物件，不要任何前後說明文字。',
      messages: [{ role: 'user', content: buildPrompt(keyword, sig) }],
    };
    if (getWebSearch()) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }];
    }

    const res = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': getKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch {}
      if (res.status === 401) throw new Error('金鑰無效或未授權（401）。請到右上角重新設定 API 金鑰。');
      throw new Error(`Claude API 錯誤 ${res.status}${detail ? '：' + detail : ''}`);
    }
    const data = await res.json();
    const blocks = data.content || [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('');

    // collect web-search citations, if any
    const sources = [];
    blocks.forEach((b) => {
      (b.citations || []).forEach((c) => {
        if (c.url && !sources.some((s) => s.url === c.url)) {
          sources.push({ url: c.url, title: c.title || c.url });
        }
      });
    });

    return { result: extractJSON(text), sources };
  }

  /* ---------- rendering ---------- */
  const LIKE_LABEL = { probable: '最可能', plausible: '合理', possible: '有可能' };

  function render(data, sig, sources) {
    const { markets, news, buzz, wiki } = sig;
    el.resultTopic.textContent = (data.topic || '').toUpperCase() || 'FORESIGHT';
    el.resultSummary.textContent = data.summary || '';

    // signals
    el.signals.innerHTML = '';
    (data.drivers || []).forEach((d) => {
      const s = document.createElement('div');
      s.className = 'signal-pill';
      s.innerHTML = `<b>訊號</b> · ${escapeHtml(d)}`;
      el.signals.appendChild(s);
    });

    // horizons
    el.horizons.innerHTML = '';
    (data.horizons || []).forEach((h) => {
      const card = document.createElement('div');
      card.className = 'horizon';
      const events = (h.events || []).map((ev) => {
        const lk = ['probable', 'plausible', 'possible'].includes(ev.likelihood) ? ev.likelihood : 'possible';
        return `<div class="event">
            <div class="event-top">
              <span class="event-title">${escapeHtml(ev.title || '')}</span>
              <span class="like like-${lk}">${LIKE_LABEL[lk]}</span>
            </div>
            <p class="event-why">${escapeHtml(ev.rationale || '')}</p>
          </div>`;
      }).join('');
      card.innerHTML = `
        <p class="horizon-range">${escapeHtml(h.range || '')}</p>
        <h3 class="horizon-head">${escapeHtml(h.headline || '')}</h3>
        ${events}`;
      el.horizons.appendChild(card);
    });

    // wildcard
    if (data.wildcard) {
      el.wildcardText.textContent = data.wildcard;
      el.wildcardBox.hidden = false;
    } else { el.wildcardBox.hidden = true; }

    // GDELT news (last 3 days)
    if (news.length) {
      el.newsList.innerHTML = news.map((n) => `
        <a class="ev-item" href="${escapeAttr(n.url)}" target="_blank" rel="noopener">
          <span class="ev-item-title">${escapeHtml(n.title)}</span>
          <span class="ev-meta"><b>${escapeHtml(n.domain || '')}</b> · ${relTime(gdeltDate(n.date))}</span>
        </a>`).join('');
      el.newsCard.hidden = false;
    } else { el.newsCard.hidden = true; }

    // Hacker News discussion
    if (buzz.length) {
      el.buzzList.innerHTML = buzz.map((b) => `
        <a class="ev-item" href="${escapeAttr(b.url)}" target="_blank" rel="noopener">
          <span class="ev-item-title">${escapeHtml(b.title)}</span>
          <span class="ev-meta"><b>👍 ${b.points}</b> · 💬 ${b.comments} · ${relTime(b.date)}</span>
        </a>`).join('');
      el.buzzCard.hidden = false;
    } else { el.buzzCard.hidden = true; }

    // Wikipedia attention trend
    if (wiki) {
      const cls = wiki.change >= 10 ? 'wiki-trend-up' : wiki.change <= -10 ? 'wiki-trend-down' : 'wiki-trend-flat';
      const sign = wiki.change >= 0 ? '▲ +' : '▼ ';
      el.wikiBody.innerHTML = `
        <div class="wiki-headline">
          <b>${wiki.total.toLocaleString()}</b> 次瀏覽 / 30 天
        </div>
        <div class="${cls}">${sign}${Math.abs(wiki.change)}% 近期關注度</div>
        ${sparkline(wiki.series)}
        <a class="ev-meta" href="${escapeAttr(wiki.pageUrl || '#')}" target="_blank" rel="noopener">${escapeHtml(wiki.title)} →</a>`;
      el.wikiCard.hidden = false;
    } else { el.wikiCard.hidden = true; }

    // market source
    if (markets.length) {
      el.marketList.innerHTML = '';
      markets.forEach((m) => {
        const item = document.createElement('div');
        item.className = 'market-item';
        item.innerHTML = `
          <span class="market-q">${escapeHtml(m.question)}</span>
          <span class="market-prob">${m.prob != null ? Math.round(m.prob * 100) + '%' : '—'}</span>
          <span class="market-vol">$${Math.round(m.volume).toLocaleString()}</span>`;
        el.marketList.appendChild(item);
      });
      el.marketSource.hidden = false;
    } else { el.marketSource.hidden = true; }

    // Claude web-search sources
    if (sources && sources.length) {
      el.claudeSources.innerHTML = '🔎 Claude 查證來源： ' + sources.slice(0, 8).map((s) =>
        `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`).join(' · ');
      el.claudeSources.hidden = false;
    } else { el.claudeSources.hidden = true; }
  }

  function sparkline(series) {
    if (!series || series.length < 2) return '';
    const w = 220, h = 44, max = Math.max(...series), min = Math.min(...series);
    const span = max - min || 1;
    const pts = series.map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - 4 - ((v - min) / span) * (h - 8);
      return [x, y];
    });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `M0,${h} ` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${w},${h} Z`;
    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path class="spark-area" d="${area}"/><path d="${line}"/></svg>`;
  }

  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- error ---------- */
  function showError(msg) {
    let banner = el.stageInput.querySelector('.err-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'err-banner';
      el.askForm.insertAdjacentElement('afterend', banner);
    }
    banner.textContent = '⚠️ ' + msg;
  }
  function clearError() {
    const b = el.stageInput.querySelector('.err-banner');
    if (b) b.remove();
  }

  /* ---------- overlay control ---------- */
  function showOverlay() {
    seedParticles();
    el.overlay.classList.remove('fade-out');
    el.overlay.classList.add('show');
    el.overlay.setAttribute('aria-hidden', 'false');
    startStatusCycle();
  }
  function hideOverlay() {
    stopStatusCycle();
    el.overlay.classList.add('fade-out');
    setTimeout(() => {
      el.overlay.classList.remove('show', 'fade-out');
      el.overlay.setAttribute('aria-hidden', 'true');
    }, 600);
  }

  /* ---------- main flow ---------- */
  async function runPrediction(keyword) {
    clearError();
    if (!getKey()) {
      showError('請先設定 Anthropic API 金鑰（右上角「設定金鑰」）。');
      openModal();
      return;
    }

    showOverlay();
    const startedAt = Date.now();
    try {
      const [markets, news, buzz, wiki] = await Promise.all([
        fetchMarkets(keyword),
        fetchGdelt(keyword),
        fetchHN(keyword),
        fetchWikiTrend(keyword),
      ]);
      const sig = { markets, news, buzz, wiki };
      const { result, sources } = await askClaude(keyword, sig);

      // keep the oracle on screen for at least the full ritual
      const elapsed = Date.now() - startedAt;
      if (elapsed < 3200) await new Promise((r) => setTimeout(r, 3200 - elapsed));

      render(result, sig, sources);
      hideOverlay();
      el.stageInput.hidden = true;
      el.stageResults.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      hideOverlay();
      showError(err.message || '預言時發生未知錯誤。');
    }
  }

  el.askForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const kw = el.keyword.value.trim();
    if (kw) runPrediction(kw);
  });

  el.resetBtn.addEventListener('click', () => {
    el.stageResults.hidden = true;
    el.stageInput.hidden = false;
    el.keyword.value = '';
    el.keyword.focus();
  });

  refreshByokNote();
})();
