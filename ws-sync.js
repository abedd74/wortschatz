/* ═══════════════════════════════════════════════════════════════════
   WSSync — sincronizzazione cloud per Wortschatz.

   Principio: PRIMA IL LOCALE. L'app legge e scrive sempre localStorage
   e funziona completamente offline. WSSync allinea in background con
   Firestore (REST, senza SDK): all'avvio scarica, dopo le modifiche
   (con debounce) carica. I conflitti si fondono per parola:
   "vince chi ha più progresso".

   Attivazione per dispositivo: aprire una volta il link personale
   (…/index.html?codice=CODICE-SEGRETO). Il codice viene salvato in
   locale e NON va mai committato nel repository — è la password.

   Finché CONFIG.projectId è "DA-COMPILARE", la sincronizzazione resta
   spenta e l'app funziona in locale.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Progetto Firebase (da compilare dopo la creazione del progetto) ──
  const CONFIG = {
    projectId: 'wortschatz-daniela',
    apiKey:    'AIzaSyAskanLnAfXhcg01l2dR0P4AYVowVipzTU',
  };

  const CODE_KEY = 'ws_sync_code';
  const META_KEY = 'ws_sync_meta';
  const PUSH_DEBOUNCE_MS = 5000;
  const PULL_MIN_INTERVAL_MS = 60000;
  const SYNCED_KEYS = ['ws_srs', 'ws_days'];

  function parse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  /* ── Fusioni ──────────────────────────────────────────────────── */
  // ws_srs: per parola vince la voce con più attività (r+w), poi scatola più alta
  function scoreEntry(e) {
    if (!e) return -1;
    return (e.r || 0) + (e.w || 0) + (e.b || 0) * 2 + (e.st === 'known' ? 1 : 0);
  }
  function mergeSrs(a, b) {
    const out = Object.assign({}, a || {});
    for (const [k, e] of Object.entries(b || {})) {
      if (scoreEntry(e) > scoreEntry(out[k])) out[k] = e;
    }
    return out;
  }
  // ws_days: massimo campo per campo, per data
  function mergeDays(a, b) {
    const out = Object.assign({}, a || {});
    for (const [d, v] of Object.entries(b || {})) {
      if (!out[d]) { out[d] = v; continue; }
      const m = Object.assign({}, out[d]);
      for (const [f, val] of Object.entries(v)) {
        m[f] = (typeof val === 'number' && typeof m[f] === 'number') ? Math.max(m[f], val) : (m[f] ?? val);
      }
      out[d] = m;
    }
    return out;
  }
  const MERGE = { ws_srs: mergeSrs, ws_days: mergeDays };

  /* ── Firestore REST ───────────────────────────────────────────── */
  function code() {
    try {
      const fromUrl = new URLSearchParams(location.search).get('codice');
      if (fromUrl) localStorage.setItem(CODE_KEY, fromUrl);
      return localStorage.getItem(CODE_KEY);
    } catch { return null; }
  }
  const enabled = () => !CONFIG.projectId.startsWith('DA-') && !!code();

  function baseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}` +
           `/databases/(default)/documents/wortschatz/${encodeURIComponent(code())}/stores`;
  }
  async function getDoc(key) {
    const res = await fetch(`${baseUrl()}/${encodeURIComponent(key)}?key=${CONFIG.apiKey}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`get ${res.status}`);
    const d = await res.json();
    return { json: d.fields?.json?.stringValue ?? null, ts: Number(d.fields?.ts?.integerValue || 0) };
  }
  async function patchDoc(key, raw) {
    const ts = Date.now();
    const body = JSON.stringify({ fields: { json: { stringValue: raw }, ts: { integerValue: String(ts) } } });
    const res = await fetch(`${baseUrl()}/${encodeURIComponent(key)}?key=${CONFIG.apiKey}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (!res.ok) throw new Error(`patch ${res.status}`);
  }

  /* ── Stato per la UI ──────────────────────────────────────────── */
  let status = 'spenta';   // spenta | sync | ok | offline
  function setStatus(s) {
    status = s;
    try { window.dispatchEvent(new CustomEvent('wssync-status', { detail: { status: s } })); } catch {}
  }

  /* ── Pull ─────────────────────────────────────────────────────── */
  let lastPull = 0;
  async function pullAll() {
    if (!enabled()) return;
    setStatus('sync');
    const changed = [];
    try {
      for (const key of SYNCED_KEYS) {
        const remote = await getDoc(key);
        const localRaw = localStorage.getItem(key);
        if (!remote || remote.json === null) {
          if (localRaw !== null) dirty.add(key);   // primo avvio: spingi il locale
          continue;
        }
        const merged = JSON.stringify(MERGE[key](parse(localRaw), parse(remote.json)));
        if (merged !== localRaw) { localStorage.setItem(key, merged); changed.push(key); }
        if (merged !== remote.json) dirty.add(key);
      }
      lastPull = Date.now();
      setStatus('ok');
      if (dirty.size) schedulePush();
      if (changed.length) {
        try { window.dispatchEvent(new CustomEvent('wssync-pulled', { detail: { keys: changed } })); } catch {}
      }
    } catch (err) {
      console.warn('[WSSync] pull fallito:', err.message);
      setStatus('offline');
    }
  }

  /* ── Push (con debounce) ──────────────────────────────────────── */
  const dirty = new Set();
  let pushTimer = null;
  function markDirty(key) {
    if (!enabled() || !SYNCED_KEYS.includes(key)) return;
    dirty.add(key);
    schedulePush();
  }
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushDirty, PUSH_DEBOUNCE_MS);
  }
  async function pushDirty() {
    if (!enabled() || !dirty.size) return;
    setStatus('sync');
    const keys = [...dirty]; dirty.clear();
    try {
      for (const key of keys) {
        let raw = localStorage.getItem(key);
        if (raw === null) continue;
        const remote = await getDoc(key);   // fondi prima di scrivere
        if (remote && remote.json !== null) {
          const merged = JSON.stringify(MERGE[key](parse(raw), parse(remote.json)));
          if (merged !== raw) { localStorage.setItem(key, merged); raw = merged; }
        }
        await patchDoc(key, raw);
      }
      setStatus('ok');
    } catch (err) {
      console.warn('[WSSync] push fallito:', err.message);
      keys.forEach(k => dirty.add(k));
      setStatus('offline');
    }
  }

  /* ── Avvio ────────────────────────────────────────────────────── */
  function init() {
    if (!enabled()) { setStatus('spenta'); return; }
    pullAll();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPull > PULL_MIN_INTERVAL_MS) pullAll();
      if (document.visibilityState === 'hidden' && dirty.size) pushDirty();
    });
    window.addEventListener('pagehide', () => { if (dirty.size) pushDirty(); });
  }

  window.WSSync = {
    init, markDirty, pullAll,
    get status() { return status; },
    get enabled() { return enabled(); },
    get hasCode() { return !!code(); },
  };
})();
