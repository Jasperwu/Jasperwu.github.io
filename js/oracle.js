/* Foresight Oracle — client-side engine
 * Data:  Polymarket Gamma API (public, CORS-enabled, no auth)
 * Brain: Anthropic Claude API (direct browser access, BYOK)
 * No backend. The API key lives only in this browser's localStorage.
 */

(() => {
  'use strict';

  const LS_KEY = 'oracle_api_key';
  const LS_MODEL = 'oracle_model';
  const GAMMA = 'https://gamma-api.polymarket.com/markets';
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
    // modal
    openSettings: $('openSettings'),
    modalBackdrop: $('modalBackdrop'),
    apiKeyInput: $('apiKeyInput'),
    modelSelect: $('modelSelect'),
    saveKey: $('saveKey'),
    clearKey: $('clearKey'),
  };

  /* ---------- key storage ---------- */
  const getKey = () => localStorage.getItem(LS_KEY) || '';
  const getModel = () => localStorage.getItem(LS_MODEL) || 'claude-sonnet-4-6';

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
    ['聆聽市場的低語…', '讀取 Polymarket 即時機率'],
    ['解析社群訊號…', 'Reddit · 社群討論 · 新聞趨勢'],
    ['以 futurist 之眼推演…', '對齊 3–18 個月的時間錐'],
    ['編織可能的未來…', '即將顯現'],
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

  /* ---------- Claude ---------- */
  function buildPrompt(keyword, markets) {
    const mkt = markets.length
      ? markets.map((m) =>
          `- "${m.question}" → ${m.outcome} ${m.prob != null ? Math.round(m.prob * 100) + '%' : 'n/a'}` +
          ` (成交量 $${Math.round(m.volume).toLocaleString()}` +
          `${m.endDate ? '，到期 ' + m.endDate.slice(0, 10) : ''})`
        ).join('\n')
      : '（這個主題目前沒有直接相關的 Polymarket 市場，請依社群與趨勢訊號推論。）';

    return `關鍵詞：「${keyword}」

來自 Polymarket 預測市場的即時數據：
${mkt}

請以一位敏銳的 futurist 角色，整合「預測市場機率」「社群與文化訊號（Reddit、論壇、社群媒體）」「新聞與搜尋趨勢」，推演這個主題在未來 18 個月的發展。

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

  async function askClaude(keyword, markets) {
    const res = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': getKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 2000,
        system: '你是一位頂尖的未來學家（futurist），擅長把預測市場數據、社群訊號與趨勢轉化為具體、可信、富洞察力的未來情境。語氣冷靜、精準、帶一點神諭的詩意。',
        messages: [{ role: 'user', content: buildPrompt(keyword, markets) }],
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch {}
      if (res.status === 401) throw new Error('金鑰無效或未授權（401）。請到右上角重新設定 API 金鑰。');
      throw new Error(`Claude API 錯誤 ${res.status}${detail ? '：' + detail : ''}`);
    }
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
    return extractJSON(text);
  }

  /* ---------- rendering ---------- */
  const LIKE_LABEL = { probable: '最可能', plausible: '合理', possible: '有可能' };

  function render(data, markets) {
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
  }

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
      const markets = await fetchMarkets(keyword);
      const data = await askClaude(keyword, markets);

      // keep the oracle on screen for at least the full ritual
      const elapsed = Date.now() - startedAt;
      if (elapsed < 3200) await new Promise((r) => setTimeout(r, 3200 - elapsed));

      render(data, markets);
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
