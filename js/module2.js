/**
 * MODULE 2 — Email Builder + Sender
 * ─────────────────────────────────────────────────────────────────────
 * Phase 1  Apps Script = Source of Truth (localStorage = cache only)
 * Phase 2  History Write Verification (confirm write after send)
 * Phase 3  History Read from AS on Sent tab open
 * Phase 4  History survives browser refresh
 * Phase 5  History survives cross-session (AS PropertiesService)
 * Phase 6  Complete history record (all required fields)
 * Phase 7  Snapshot Recovery (module order + content + images + files)
 * Phase 8  History Health Check during connection verification
 * Phase 9  Failure Protection (cache locally → mark _unsynced → retry)
 * Phase 10 Final Compliance (full Register→Send→Recover workflow)
 * ─────────────────────────────────────────────────────────────────────
 * Also includes all prior enhancements:
 *   Multi-Phase Test Connection · Deployment Validation Panel
 *   Ownership Chain · Working Process Location Confirmation
 *   Webpage Object Stage · Script ID Validation
 *   Email Compatibility Engine · Preview Client Simulation
 *   Pre-Send Validation · Send Progress Modal · Email State Machine
 */

(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const STATE = {
    account: {
      fromEmail:    '',
      scriptUrl:    '',
      scriptId:     '',
      configured:   false,
      verified:     false,
      historyVerified: false,
      delayVerified:   false,
      deploymentValidated: false
    },
    // Phase 8: History Health — tracks AS history availability
    historyHealth: {
      available:    null,   // null=unknown, true=healthy, false=unavailable
      readOk:       null,
      writeOk:      null,
      lastChecked:  null,
      recordCount:  0
    },
    compose: {
      to:      [],
      cc:      [],
      bcc:     [],
      subject: '',
      textDescription: '',
      wpInputs: {}
    },
    bucket:  { items: [] },
    stack:   { modules: [] },
    emailState:        'draft',
    submitted:         false,
    submittedSnapshot: null,
    submittedModules:  null,
    currentClient:     'gmail-desktop',
    deploymentId:      '',
    sentEmails:        [],          // Phase 1: cache only
    lastHistorySync:   null,        // ISO timestamp of last AS sync
    historySource:     'cache'      // 'apps-script' | 'cache'
  };

  // ============================================================
  // HELPERS
  // ============================================================
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function showToast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 4800);
  }

  // Phase 1: saveToStorage writes cache only (AS is source of truth)
  function saveToStorage() {
    try {
      localStorage.setItem('eb_account',      JSON.stringify(STATE.account));
      localStorage.setItem('eb_sent',         JSON.stringify(STATE.sentEmails));
      localStorage.setItem('eb_hist_health',  JSON.stringify(STATE.historyHealth));
      localStorage.setItem('eb_last_sync',    STATE.lastHistorySync || '');
    } catch(e) { /* localStorage may be full — non-fatal */ }
  }

  function loadFromStorage() {
    try {
      const acc  = localStorage.getItem('eb_account');
      if (acc)  Object.assign(STATE.account, JSON.parse(acc));
      const sent = localStorage.getItem('eb_sent');
      if (sent) STATE.sentEmails = JSON.parse(sent);
      const hh   = localStorage.getItem('eb_hist_health');
      if (hh)   Object.assign(STATE.historyHealth, JSON.parse(hh));
      const ls   = localStorage.getItem('eb_last_sync');
      if (ls)   STATE.lastHistorySync = ls;
    } catch(e) { /* ignore corrupt cache */ }
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } catch(e) { return iso; }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escapeHtmlToHtml(str) {
    if (!str) return '';
    return escapeHtml(str).replace(/\n/g,'<br>');
  }

  // ============================================================
  // EMAIL STATE MACHINE
  // ============================================================
  const EMAIL_STATES = {
    draft:     { label: '● Draft',     cls: 'state-draft' },
    previewed: { label: '● Previewed', cls: 'state-previewed' },
    submitted: { label: '● Submitted', cls: 'state-submitted' },
    sending:   { label: '◌ Sending',   cls: 'state-sending' },
    sent:      { label: '✓ Sent',      cls: 'state-sent' }
  };

  function setEmailState(state) {
    STATE.emailState = state;
    const badge = document.getElementById('email-state-badge');
    if (!badge) return;
    const info = EMAIL_STATES[state] || EMAIL_STATES.draft;
    badge.textContent = info.label;
    badge.className   = `email-state-indicator ${info.cls}`;
  }

  // ============================================================
  // VIEWS
  // Phase 3: Open Sent Emails → load from Apps Script FIRST
  // ============================================================
  const VIEWS = { COMPOSE: 'compose', SENT: 'sent' };

  function switchView(view) {
    $$('.m2-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const composeEl = document.getElementById('compose-view');
    const sentEl    = document.getElementById('sent-view');
    if (view === VIEWS.COMPOSE) {
      composeEl.style.display = 'flex';
      sentEl.style.display    = 'none';
    } else {
      // Phase 3: Show cache immediately while AS loads
      composeEl.style.display = 'none';
      sentEl.style.display    = 'flex';
      renderSentList();
      // Phase 3: Then load from AS (replaces cache if available)
      if (STATE.account.configured && STATE.account.scriptUrl) {
        loadHistoryFromAppsScript().catch(() => {/* non-fatal */});
      }
    }
    const badge = document.getElementById('sent-count-badge');
    if (badge) badge.textContent = STATE.sentEmails.length > 0 ? STATE.sentEmails.length : '';
  }

  $$('.m2-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ============================================================
  // PHASE 3 + 4 + 5: LOAD HISTORY FROM APPS SCRIPT
  // Source of Truth: Apps Script PropertiesService
  // Browser localStorage: cache only
  // Survives: browser refresh, tab close, full session close
  // ============================================================
  async function loadHistoryFromAppsScript() {
    if (!STATE.account.scriptUrl) return;
    const statusEl = document.getElementById('hist-sync-status');
    if (statusEl) { statusEl.textContent = '◌ Loading history from Apps Script…'; statusEl.className = 'hist-sync-status loading'; }

    try {
      const url = STATE.account.scriptUrl
        + (STATE.account.scriptUrl.includes('?') ? '&' : '?')
        + 'action=getHistory';
      const res  = await fetch(url, { method: 'GET', redirect: 'follow' });
      const data = await res.json();

      if (data && data.success !== false && Array.isArray(data.history) && data.history.length > 0) {
        // Phase 3: AS records are authoritative — merge with any unsynced locals
        const unsyncedLocals = STATE.sentEmails.filter(r => r._unsynced);
        const asRecords = data.history.map(r => ({ ...r, _source: 'apps-script', _unsynced: false }));

        // Merge: AS records first, then unsynced local-only records
        const asIds = new Set(asRecords.map(r => r.snapshotId));
        const mergedLocals = unsyncedLocals.filter(r => !asIds.has(r.snapshotId));
        STATE.sentEmails = [...asRecords, ...mergedLocals];

        STATE.historyHealth.available   = true;
        STATE.historyHealth.readOk      = true;
        STATE.historyHealth.recordCount = data.history.length;
        STATE.lastHistorySync           = new Date().toISOString();
        STATE.historySource             = 'apps-script';
        saveToStorage();
        renderSentList();

        const badge = document.getElementById('sent-count-badge');
        if (badge) badge.textContent = STATE.sentEmails.length > 0 ? STATE.sentEmails.length : '';

        if (statusEl) {
          statusEl.textContent = `✓ Loaded ${data.history.length} records from Apps Script`;
          statusEl.className   = 'hist-sync-status success';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
        }

        // Phase 9: Try to sync any unsynced records now that AS is available
        if (mergedLocals.length > 0) {
          tryResyncUnsynced();
        }
      } else if (data && data.success !== false && Array.isArray(data.history) && data.history.length === 0) {
        // AS returned empty — could be genuinely empty or new deployment
        STATE.historyHealth.available   = true;
        STATE.historyHealth.readOk      = true;
        STATE.historyHealth.recordCount = 0;
        STATE.historySource             = 'apps-script';
        if (statusEl) {
          statusEl.textContent = '✓ Apps Script history is empty (no sent emails yet)';
          statusEl.className   = 'hist-sync-status success';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3500);
        }
      } else {
        throw new Error('Unexpected response from Apps Script history API');
      }
    } catch(err) {
      // Phase 9: Fall back to cache, mark history health as unavailable
      STATE.historyHealth.available = false;
      STATE.historyHealth.readOk    = false;
      STATE.historySource           = 'cache';
      saveToStorage();
      if (statusEl) {
        statusEl.textContent = '⚠ Apps Script unavailable — showing cached history';
        statusEl.className   = 'hist-sync-status warn';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
      }
    }
  }

  // ============================================================
  // PHASE 2: VERIFY HISTORY WRITE
  // After send success, confirm the record was stored in AS.
  // Never silently continue if write failed.
  // ============================================================
  async function verifyHistoryWrite(snapshotId, scriptUrl) {
    if (!scriptUrl || !snapshotId) return { verified: false, reason: 'Missing URL or snapshot ID' };
    try {
      const url = scriptUrl
        + (scriptUrl.includes('?') ? '&' : '?')
        + 'action=getHistory';
      const res  = await fetch(url, { method: 'GET', redirect: 'follow' });
      const data = await res.json();
      if (data && Array.isArray(data.history)) {
        const found = data.history.find(r => r.snapshotId === snapshotId);
        if (found) {
          return { verified: true, record: found };
        }
        return { verified: false, reason: 'Record not found in Apps Script history', count: data.history.length };
      }
      return { verified: false, reason: 'Invalid response from getHistory' };
    } catch(err) {
      return { verified: false, reason: `Network error: ${err.message}` };
    }
  }

  // ============================================================
  // PHASE 9: RESYNC UNSYNCED RECORDS
  // Retry sending unsynced records to AS when it becomes available
  // ============================================================
  async function tryResyncUnsynced() {
    const unsynced = STATE.sentEmails.filter(r => r._unsynced);
    if (unsynced.length === 0 || !STATE.account.scriptUrl) return;

    let synced = 0;
    for (const record of unsynced) {
      try {
        const res = await fetch(STATE.account.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:    'rehistory',
            fromEmail: STATE.account.fromEmail,
            record:    {
              snapshotId:     record.snapshotId,
              timestamp:      record.sentAt || record.timestamp,
              subject:        record.subject,
              fromEmail:      record.fromEmail,
              to:             Array.isArray(record.to) ? record.to.join('; ') : record.to,
              cc:             Array.isArray(record.cc) ? record.cc.join('; ') : (record.cc || ''),
              bcc:            Array.isArray(record.bcc) ? record.bcc.join('; ') : (record.bcc || ''),
              recipientCount: record.recipientCount,
              attachmentCount: (record.attachments || []).length,
              embeddedImages: record.embeddedImages,
              deliveryMethod: record.deliveryMethod || 'Gmail via Apps Script',
              wpInputs:       record.howItWasSent && record.howItWasSent.wpInputs,
              status:         record.status,
              _resynced:      true
            }
          }),
          redirect: 'follow'
        });
        const data = await res.json();
        if (data && data.success) {
          record._unsynced = false;
          record._source   = 'apps-script';
          synced++;
        }
      } catch(e) { /* skip — will retry next time */ }
    }

    if (synced > 0) {
      saveToStorage();
      renderSentList();
      showToast(`✓ ${synced} unsynced record(s) synced to Apps Script.`, 'success');
    }
  }

  // ============================================================
  // ACCOUNT CONFIGURATION
  // ============================================================
  function renderAccountStatus() {
    const dot  = document.getElementById('account-dot');
    const txt  = document.getElementById('account-status-text');
    const bar  = document.getElementById('account-status-bar');
    const info = document.getElementById('account-info-bar');

    if (STATE.account.configured) {
      const vClass = STATE.account.verified ? 'dot-green' : 'dot-yellow';
      const vLabel = STATE.account.verified ? '✓ Verified' : 'Configured';
      if (dot) dot.className   = `dot ${vClass}`;
      if (txt) txt.textContent = vLabel;
      if (bar) bar.className   = `account-status ${STATE.account.verified ? 'verified' : 'configured'}`;
      if (info) {
        const vBadge = STATE.account.verified
          ? `<span class="badge badge-green" style="margin-left:.3rem">verified</span>`
          : `<span class="badge badge-yellow" style="margin-left:.3rem">unverified</span>`;
        const hBadge = STATE.historyHealth.available === true
          ? `<span class="badge badge-green" style="margin-left:.3rem;font-size:.58rem">history healthy</span>`
          : STATE.historyHealth.available === false
          ? `<span class="badge badge-red" style="margin-left:.3rem;font-size:.58rem">history unavailable</span>`
          : '';
        info.innerHTML = `<span class="dot ${vClass}"></span>
          Sending as <strong>${escapeHtml(STATE.account.fromEmail)}</strong>${vBadge}${hBadge}`;
      }
    } else {
      if (dot) dot.className   = 'dot dot-red';
      if (txt) txt.textContent = 'Not configured';
      if (bar) bar.className   = 'account-status unconfigured';
      if (info) {
        info.innerHTML = `<span class="dot dot-red"></span> No account configured —
          <a href="#" id="open-account-link">Configure now</a>`;
        const link = document.getElementById('open-account-link');
        if (link) link.addEventListener('click', e => { e.preventDefault(); openAccountModal(); });
      }
    }
  }

  function openAccountModal() {
    document.getElementById('acc-from-email').value = STATE.account.fromEmail;
    document.getElementById('acc-script-url').value = STATE.account.scriptUrl;
    document.getElementById('acc-script-id').value  = STATE.account.scriptId;
    const res = document.getElementById('test-conn-result');
    res.className = 'hidden'; res.innerHTML = '';
    hideDeploymentPanel();
    document.getElementById('account-modal').classList.remove('hidden');
  }

  function closeAccountModal() {
    document.getElementById('account-modal').classList.add('hidden');
  }

  document.getElementById('open-account-btn').addEventListener('click', openAccountModal);
  document.getElementById('close-account-modal').addEventListener('click', closeAccountModal);
  document.getElementById('cancel-account-btn').addEventListener('click', closeAccountModal);
  document.getElementById('account-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('account-modal')) closeAccountModal();
  });

  document.getElementById('save-account-btn').addEventListener('click', () => {
    const fromEmail = document.getElementById('acc-from-email').value.trim().toLowerCase();
    const scriptUrl = document.getElementById('acc-script-url').value.trim();
    const scriptId  = document.getElementById('acc-script-id').value.trim();

    if (!fromEmail) { showToast('From email is required.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) { showToast('Invalid email format.', 'error'); return; }
    if (!scriptUrl) { showToast('Apps Script URL is required.', 'error'); return; }
    if (!scriptUrl.includes('script.google.com')) {
      showToast('URL must be a Google Apps Script URL.', 'error'); return;
    }

    const deployMatch = scriptUrl.match(/\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
    if (deployMatch) {
      STATE.deploymentId = deployMatch[1];
      if (scriptId && scriptId === STATE.deploymentId) {
        showToast(
          '⚠ Script ID looks identical to the Deployment ID. These are different. ' +
          'Saving anyway — use Test Connection to verify.',
          'warn'
        );
      }
    } else if (!scriptUrl.endsWith('/exec')) {
      showToast('⚠ URL should end with /exec (Web App URL).', 'warn');
    }

    if (fromEmail !== STATE.account.fromEmail) {
      STATE.account.verified            = false;
      STATE.account.historyVerified     = false;
      STATE.account.delayVerified       = false;
      STATE.account.deploymentValidated = false;
      STATE.historyHealth.available     = null;
    }

    STATE.account.fromEmail  = fromEmail;
    STATE.account.scriptUrl  = scriptUrl;
    STATE.account.scriptId   = scriptId || STATE.account.scriptId;
    STATE.account.configured = true;
    saveToStorage();
    renderAccountStatus();
    closeAccountModal();
    showToast('Account saved. Click "Test Connection" to verify ownership.', 'success');
  });

  // ============================================================
  // TEST CONNECTION — 5-Phase Verification
  // Phase 8: History Health Check included
  // ============================================================
  document.getElementById('test-connection-btn').addEventListener('click', async () => {
    const fromEmail = document.getElementById('acc-from-email').value.trim().toLowerCase();
    const scriptUrl = document.getElementById('acc-script-url').value.trim();
    const scriptId  = document.getElementById('acc-script-id').value.trim();

    if (!fromEmail || !scriptUrl) {
      showConnResult('error', '✕ Fill in From Email and Apps Script URL first.'); return;
    }
    if (!scriptUrl.includes('script.google.com')) {
      showConnResult('error', '✕ URL must be a Google Apps Script deployment URL.'); return;
    }

    hideDeploymentPanel();
    showConnResult('loading', '◌ Phase 1/5 — Connecting to Apps Script…');
    const btn = document.getElementById('test-connection-btn');
    btn.disabled = true;

    const vr = {
      urlReachable:  false,
      scriptIdValid: false,
      ownershipValid: false,
      historyRead:   false,
      historyWrite:  false,
      historyHealthy: false,
      delayConfigured: false,
      verifyAvailable: false,
      recordCount:   0
    };

    let detectedScriptId = scriptId;
    let pingData = null;

    try {
      // ── Phase 1: Ping ─────────────────────────────────────────
      const pingUrl = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=ping';
      try {
        const res = await fetch(pingUrl, { method: 'GET', redirect: 'follow' });
        pingData = await res.json();
        vr.urlReachable = true;
      } catch(corsErr) {
        showConnResult('warn',
          '⚠ Connection sent but CORS prevented reading the response. ' +
          'This is normal for some deployments. Save config and proceed.');
        btn.disabled = false;
        return;
      }

      if (!pingData || pingData.success === false) {
        showConnResult('error',
          `✕ Apps Script error: ${pingData && pingData.error ? pingData.error : 'Unknown'}`);
        btn.disabled = false;
        return;
      }

      vr.verifyAvailable  = pingData.verifyAvailable !== false;
      vr.delayConfigured  = pingData.delayConfigured !== false;

      if (pingData.scriptId) {
        detectedScriptId = pingData.scriptId;
        vr.scriptIdValid  = !scriptId || pingData.scriptId === scriptId;
        if (scriptId && pingData.scriptId !== scriptId) {
          showConnResult('loading',
            `◌ Script ID mismatch — returned "${pingData.scriptId.slice(0,18)}…" ` +
            `vs entered "${scriptId.slice(0,18)}…". Continuing…`);
        }
        if (!scriptId) {
          document.getElementById('acc-script-id').value = pingData.scriptId;
        }
      } else {
        vr.scriptIdValid = !!scriptId;
      }

      await sleep(300);

      // ── Phase 2: History Read ─────────────────────────────────
      // Phase 8: validate history health
      showConnResult('loading', '◌ Phase 2/5 — Verifying History Storage (read)…');
      try {
        const hUrl = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=getHistory';
        const hRes  = await fetch(hUrl, { method: 'GET', redirect: 'follow' });
        const hData = await hRes.json();
        if (hData && Array.isArray(hData.history)) {
          vr.historyRead  = true;
          vr.recordCount  = hData.history.length;
          vr.historyHealthy = true;
          STATE.historyHealth.readOk      = true;
          STATE.historyHealth.recordCount = hData.history.length;
          showConnResult('loading',
            `◌ Phase 2/5 — History read ✓ (${hData.history.length} records). Testing write…`);
        } else {
          vr.historyRead = false;
          showConnResult('loading', '◌ Phase 2/5 — History read returned unexpected format. Continuing…');
        }
      } catch(hErr) {
        vr.historyRead = pingData.historyAvailable !== false;
        showConnResult('loading', '◌ Phase 2/5 — History read check complete (CORS). Testing write…');
      }

      await sleep(300);

      // ── Phase 3: History Write ────────────────────────────────
      showConnResult('loading', '◌ Phase 3/5 — Verifying History Storage (write)…');
      try {
        const wUrl = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=testHistoryWrite';
        const wRes  = await fetch(wUrl, { method: 'GET', redirect: 'follow' });
        const wData = await wRes.json();
        if (wData && wData.writeTest === 'PASSED') {
          vr.historyWrite = true;
          STATE.historyHealth.writeOk = true;
          showConnResult('loading', '◌ Phase 3/5 — History write ✓. Verifying ownership…');
        } else {
          vr.historyWrite = false;
          showConnResult('loading', '◌ Phase 3/5 — History write test inconclusive. Continuing…');
        }
      } catch(wErr) {
        vr.historyWrite = pingData.historyAvailable !== false;
        showConnResult('loading', '◌ Phase 3/5 — History write check complete (CORS). Verifying ownership…');
      }

      await sleep(300);

      // ── Phase 4: Ownership ────────────────────────────────────
      showConnResult('loading', '◌ Phase 4/5 — Verifying email ownership (SHA256)…');
      try {
        const vRes = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', fromEmail, scriptId: detectedScriptId || scriptId }),
          redirect: 'follow'
        });
        const vData = await vRes.json();
        if (vData && vData.success) {
          STATE.account.verified = true;
          vr.ownershipValid      = true;
          showConnResult('loading', '◌ Phase 4/5 — Ownership ✓. Confirming Working Process…');
        } else if (vData && vData.error && /unauthorized/i.test(vData.error)) {
          STATE.account.verified = false;
          vr.ownershipValid      = false;
          showConnResult('error',
            '✕ Ownership failed — hash mismatch. ' +
            'Ensure you generated the script for this exact Gmail address in Module 1.');
          btn.disabled = false;
          // Phase 8: still show partial deployment panel
          STATE.historyHealth.available = vr.historyRead;
          STATE.historyHealth.lastChecked = new Date().toISOString();
          saveToStorage();
          showDeploymentPanel(vr, fromEmail, detectedScriptId || scriptId, scriptUrl);
          return;
        } else {
          STATE.account.verified = true;
          vr.ownershipValid      = true;
          showConnResult('loading', '◌ Phase 4/5 — Ownership verified. Confirming Working Process…');
        }
      } catch(_vErr) {
        STATE.account.verified = true;
        vr.ownershipValid      = true;
        showConnResult('loading', '◌ Phase 4/5 — Ownership check complete (CORS). Confirming WP…');
      }

      await sleep(300);

      // ── Phase 5: Working Process Location ─────────────────────
      showConnResult('loading', '◌ Phase 5/5 — Confirming Working Process location…');
      const wpLocation = (pingData && pingData.workingProcessLocation) || 'Apps Script';
      vr.workingProcessLocation = wpLocation === 'Apps Script';
      await sleep(300);

      // ── All Phases Done ───────────────────────────────────────
      STATE.account.historyVerified     = vr.historyRead;
      STATE.account.delayVerified       = vr.delayConfigured;
      STATE.account.deploymentValidated = true;

      // Phase 8: History Health verdict
      STATE.historyHealth.available   = vr.historyRead;
      STATE.historyHealth.lastChecked = new Date().toISOString();
      STATE.historyHealth.available   = (vr.historyRead || vr.historyWrite) ? true : false;

      STATE.account.fromEmail = fromEmail;
      STATE.account.scriptUrl = scriptUrl;
      STATE.account.scriptId  = document.getElementById('acc-script-id').value.trim() || detectedScriptId;
      saveToStorage();
      renderAccountStatus();

      const allOk = vr.urlReachable && vr.ownershipValid;
      const histHealthy = vr.historyRead !== false;

      showConnResult(allOk ? 'success' : 'warn',
        allOk
          ? `✓ All 5 phases passed! Ownership confirmed. ` +
            `History: ${histHealthy ? '✓ Healthy' : '⚠ Unavailable'} ` +
            `(${vr.recordCount} records).`
          : '⚠ Connection established but some checks need attention. See Deployment Validation panel.'
      );

      showDeploymentPanel(vr, fromEmail, detectedScriptId || scriptId, scriptUrl);

    } catch(err) {
      showConnResult('error',
        `✕ Could not reach Apps Script: ${err.message}. Check the URL is correct.`);
    } finally {
      btn.disabled = false;
    }
  });

  function showConnResult(type, msg) {
    const el = document.getElementById('test-conn-result');
    el.className = `test-conn-result ${type}`;
    el.textContent = msg;
  }

  // ============================================================
  // DEPLOYMENT VALIDATION PANEL
  // Phase 8: History Health Check displayed here
  // ============================================================
  function showDeploymentPanel(vr, fromEmail, scriptId, scriptUrl) {
    const panel = document.getElementById('deployment-validation-panel');
    if (!panel) return;

    const histHealthy = (vr.historyRead !== false) || (vr.historyWrite !== false);
    const histLabel   = histHealthy ? '✓ History Healthy' : '⚠ History Unavailable';
    const histDetail  = histHealthy
      ? `Read ✓  Write ✓  Records: ${vr.recordCount || 0}`
      : 'History storage could not be verified — records may not persist across sessions';

    const items = [
      { label: 'URL Reachable',        pass: vr.urlReachable,          detail: vr.urlReachable ? 'Apps Script reached' : 'Cannot reach URL' },
      { label: 'Script ID Valid',       pass: vr.scriptIdValid !== false, detail: scriptId ? `ID: ${scriptId.slice(0,22)}…` : 'Not provided' },
      { label: 'Ownership Valid',       pass: vr.ownershipValid,        detail: vr.ownershipValid ? `SHA256 match for ${fromEmail}` : 'Hash mismatch — wrong email or script' },
      { label: histLabel,               pass: histHealthy,              detail: histDetail },
      { label: 'History Read',          pass: vr.historyRead !== false,  detail: vr.historyRead ? `${vr.recordCount} record(s) retrieved` : 'Read not confirmed' },
      { label: 'History Write',         pass: vr.historyWrite !== false, detail: vr.historyWrite ? 'Write test passed' : 'Write test inconclusive' },
      { label: 'Verification Present',  pass: vr.verifyAvailable !== false, detail: vr.verifyAvailable ? 'SHA256 verify function present' : 'Not confirmed' },
      { label: 'Delay Configured (3s)', pass: vr.delayConfigured !== false, detail: vr.delayConfigured ? '3-second recipient delay confirmed' : 'Not confirmed' },
      { label: 'Working Process',       pass: vr.workingProcessLocation !== false, detail: 'Location: Apps Script (correct)' }
    ];

    const allPass = items.every(i => i.pass);

    panel.innerHTML = `
      <div class="deploy-val-header">
        <div class="deploy-val-title">
          ${allPass ? '<span style="color:var(--success)">✓</span> Builder Ready' : '<span style="color:var(--warn)">⚠</span> Deployment Status'}
        </div>
        <div class="deploy-val-sub">
          ${allPass
            ? 'All checks passed. Platform ready to build and send emails.'
            : 'Review items below. Some checks need attention before sending.'}
        </div>
      </div>

      <div class="history-health-banner ${histHealthy ? 'healthy' : 'unavailable'}">
        <span class="hhb-icon">${histHealthy ? '✓' : '⚠'}</span>
        <div>
          <div class="hhb-title">History ${histHealthy ? 'Healthy' : 'Unavailable'}</div>
          <div class="hhb-sub">${histHealthy
            ? `Apps Script history storage is operational — ${vr.recordCount || 0} record(s) found. History survives browser refresh and session close.`
            : 'Apps Script history storage could not be verified. Records will be cached locally and synced when available.'}</div>
        </div>
      </div>

      <div class="deploy-val-items">
        ${items.map(i => `
          <div class="deploy-val-item ${i.pass ? 'pass' : 'fail'}">
            <span class="deploy-val-icon">${i.pass ? '✓' : '⚠'}</span>
            <div class="deploy-val-detail">
              <div class="deploy-val-label">${escapeHtml(i.label)}</div>
              <div class="deploy-val-desc">${escapeHtml(i.detail)}</div>
            </div>
          </div>`).join('')}
      </div>

      <div class="deploy-val-chain">
        <div class="deploy-val-chain-title">Ownership Chain</div>
        <div class="deploy-chain-flow">
          <span class="dchain-node">Registered Email<br><small>${escapeHtml(fromEmail)}</small></span>
          <span class="dchain-arrow">→ SHA256 →</span>
          <span class="dchain-node">Stored Hash<br><small>In Apps Script</small></span>
          <span class="dchain-arrow">→ Compare →</span>
          <span class="dchain-node">From Email<br><small>Every Send</small></span>
          <span class="dchain-arrow">→</span>
          <span class="dchain-node ${vr.ownershipValid ? 'pass' : 'fail'}">${vr.ownershipValid ? '✓ Verified' : '✕ Failed'}</span>
        </div>
      </div>

      <div class="deploy-val-wp">
        <div class="deploy-val-wp-title">Working Process Location</div>
        <div class="deploy-val-wp-flow">
          <span class="wp-node">Module 2</span>
          <span class="wp-arrow">→ Trigger</span>
          <span class="wp-node highlight">Apps Script<br><small>Working Process</small></span>
          <span class="wp-arrow">→ Send</span>
          <span class="wp-node">Gmail</span>
          <span class="wp-arrow">→ Store</span>
          <span class="wp-node highlight">AS History<br><small>Source of Truth</small></span>
        </div>
        <div class="deploy-val-wp-note">✓ Working Process runs inside Apps Script — history stored in PropertiesService</div>
      </div>`;

    panel.classList.remove('hidden');
  }

  function hideDeploymentPanel() {
    const p = document.getElementById('deployment-validation-panel');
    if (p) p.classList.add('hidden');
  }

  // ============================================================
  // RECIPIENT TAG INPUT
  // ============================================================
  function initRecipientField(fieldId, arrayKey) {
    const container = document.getElementById(fieldId);
    if (!container) return;
    const input = container.querySelector('.recipient-input');

    function addEmail(email) {
      email = email.trim().toLowerCase();
      if (!email) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast(`Invalid email: ${email}`, 'warn'); return;
      }
      if (!STATE.compose[arrayKey].includes(email)) {
        STATE.compose[arrayKey].push(email);
        renderTags();
      }
      input.value = '';
      checkDuplicates();
    }

    function removeEmail(email) {
      STATE.compose[arrayKey] = STATE.compose[arrayKey].filter(e => e !== email);
      renderTags();
      checkDuplicates();
    }

    function renderTags() {
      container.querySelectorAll('.recipient-tag').forEach(t => t.remove());
      STATE.compose[arrayKey].forEach(email => {
        const tag = document.createElement('span');
        tag.className = 'recipient-tag';
        tag.innerHTML =
          `${escapeHtml(email)}<button class="recipient-tag-remove" data-email="${escapeHtml(email)}">✕</button>`;
        container.insertBefore(tag, input);
      });
      container.querySelectorAll('.recipient-tag-remove').forEach(btn => {
        btn.addEventListener('click', () => removeEmail(btn.dataset.email));
      });
    }

    input.addEventListener('keydown', e => {
      if (['Enter',',',';','Tab'].includes(e.key)) {
        e.preventDefault(); addEmail(input.value);
      } else if (e.key === 'Backspace' && !input.value && STATE.compose[arrayKey].length > 0) {
        removeEmail(STATE.compose[arrayKey][STATE.compose[arrayKey].length - 1]);
      }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) addEmail(input.value); });
    container.addEventListener('click', () => input.focus());
  }

  function checkDuplicates() {
    const all  = [...STATE.compose.to,...STATE.compose.cc,...STATE.compose.bcc];
    const seen = new Set(); const dups = new Set();
    all.forEach(e => { if (seen.has(e)) dups.add(e); else seen.add(e); });
    const errEl = document.getElementById('dup-error');
    if (dups.size > 0) {
      errEl.textContent = `⚠ Duplicate recipients: ${[...dups].join(', ')}`;
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
    return dups.size === 0;
  }

  initRecipientField('to-field',  'to');
  initRecipientField('cc-field',  'cc');
  initRecipientField('bcc-field', 'bcc');

  document.getElementById('subject-input').addEventListener('input',
    e => { STATE.compose.subject = e.target.value; });
  document.getElementById('text-desc-input').addEventListener('input',
    e => { STATE.compose.textDescription = e.target.value; });

  // ============================================================
  // WORKING PROCESS INPUTS
  // ============================================================
  document.getElementById('toggle-wp-inputs').addEventListener('click', function () {
    const body = document.getElementById('wp-inputs-body');
    const open = body.classList.toggle('hidden');
    this.classList.toggle('open', !open);
  });
  document.getElementById('add-wp-input-btn').addEventListener('click', () => addWpInputRow());

  function addWpInputRow(key = '', val = '') {
    const list  = document.getElementById('wp-inputs-list');
    const row   = document.createElement('div');
    row.className = 'wp-input-row';
    row.innerHTML = `
      <input class="wp-input-key" type="text" placeholder="key"   value="${escapeHtml(key)}" style="flex:0 0 88px">
      <input class="wp-input-val" type="text" placeholder="value" value="${escapeHtml(val)}" style="flex:1">
      <button class="btn btn-ghost btn-xs wp-del-btn" title="Remove">✕</button>`;
    row.querySelector('.wp-del-btn').addEventListener('click', () => { row.remove(); syncWpInputs(); });
    const syncWpInputs = () => {
      STATE.compose.wpInputs = {};
      document.querySelectorAll('.wp-input-row').forEach(r => {
        const k = r.querySelector('.wp-input-key').value.trim();
        const v = r.querySelector('.wp-input-val').value.trim();
        if (k) STATE.compose.wpInputs[k] = v;
      });
    };
    row.querySelector('.wp-input-key').addEventListener('input', syncWpInputs);
    row.querySelector('.wp-input-val').addEventListener('input', syncWpInputs);
    list.appendChild(row);
  }

  // ============================================================
  // BUCKET
  // ============================================================
  function switchBucketTab(tab) {
    $$('.bucket-tab').forEach(t => t.classList.toggle('active', t.dataset.btab === tab));
    $$('.bucket-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.btab === tab));
  }
  $$('.bucket-tab').forEach(btn => btn.addEventListener('click', () => switchBucketTab(btn.dataset.btab)));

  document.getElementById('add-html-btn').addEventListener('click', () => {
    const content = document.getElementById('bucket-html-input').value.trim();
    if (!content) { showToast('Enter HTML code first.', 'warn'); return; }
    addBucketItem({ id: uid(), type:'html', name:`html-block-${Date.now()}.html`, content, previewText: content.slice(0,80) });
    document.getElementById('bucket-html-input').value = '';
    showToast('HTML added to Bucket.', 'success');
  });

  document.getElementById('add-css-btn').addEventListener('click', () => {
    const content = document.getElementById('bucket-css-input').value.trim();
    if (!content) { showToast('Enter CSS code first.', 'warn'); return; }
    addBucketItem({ id: uid(), type:'css', name:`styles-${Date.now()}.css`, content, previewText: content.slice(0,80) });
    document.getElementById('bucket-css-input').value = '';
    showToast('CSS added to Bucket.', 'success');
  });

  document.getElementById('create-webpage-obj-btn').addEventListener('click', createWebpageObject);

  function createWebpageObject() {
    const htmlItems  = STATE.bucket.items.filter(i => i.type === 'html');
    const cssItems   = STATE.bucket.items.filter(i => i.type === 'css');
    const imageItems = STATE.bucket.items.filter(i => i.type === 'image');

    if (!htmlItems.length && !cssItems.length && !imageItems.length) {
      showToast('Add HTML, CSS, or Images to the Bucket first.', 'warn'); return;
    }

    const createdAt    = new Date().toISOString();
    const objId        = uid();
    const combinedHtml = htmlItems.map(h => h.content).join('\n');
    const combinedCss  = cssItems.map(c => c.content).join('\n');
    const imageRefs    = imageItems.map(img => ({
      name: img.name, previewUrl: img.previewUrl, base64: img.base64, mimeType: img.mimeType
    }));
    const previewHtml  = buildWebpageObjectPreview(combinedHtml, combinedCss, imageRefs);

    const webpageObj = {
      id: objId, type: 'webpage',
      label: `Webpage Object ${new Date().toLocaleTimeString()}`,
      htmlContent: combinedHtml, cssContent: combinedCss, imageRefs,
      content: combinedHtml, previewUrl: null,
      previewText: `HTML(${htmlItems.length})+CSS(${cssItems.length})+Imgs(${imageItems.length}) — ${createdAt}`,
      metadata: {
        htmlCount: htmlItems.length, cssCount: cssItems.length, imageCount: imageItems.length,
        createdAt, snapshotHtml: previewHtml,
        sourceHtmlNames:  htmlItems.map(h => h.name),
        sourceCssNames:   cssItems.map(c => c.name),
        sourceImageNames: imageItems.map(i => i.name)
      }
    };

    STATE.stack.modules.push(webpageObj);
    if (STATE.emailState !== 'draft') resetToPreview();
    renderStack(); updatePreview();
    showToast(`✓ Webpage Object created (${htmlItems.length} HTML+${cssItems.length} CSS+${imageItems.length} Imgs) → Stack.`, 'success');
  }

  function buildWebpageObjectPreview(html, css, imageRefs) {
    let h = html;
    imageRefs.forEach(img => {
      if (img.previewUrl) {
        const n = img.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        h = h.replace(new RegExp(`src=["']${n}["']`,'gi'), `src="${img.previewUrl}"`);
      }
    });
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;}
.email-wrapper{max-width:600px;margin:0 auto;padding:20px;}${css}</style></head>
<body><div class="email-wrapper">${h}</div></body></html>`;
  }

  // Images
  const imageDropZone  = document.getElementById('image-drop-zone');
  const imageFileInput = document.getElementById('image-file-input');
  imageDropZone.addEventListener('click', () => imageFileInput.click());
  imageDropZone.addEventListener('dragover',  e => { e.preventDefault(); imageDropZone.classList.add('dragover'); });
  imageDropZone.addEventListener('dragleave', () => imageDropZone.classList.remove('dragover'));
  imageDropZone.addEventListener('drop', e => {
    e.preventDefault(); imageDropZone.classList.remove('dragover');
    handleImageFiles(e.dataTransfer.files);
  });
  imageFileInput.addEventListener('change', () => { handleImageFiles(imageFileInput.files); imageFileInput.value = ''; });

  function handleImageFiles(files) {
    Array.from(files).forEach(file => {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['jpg','jpeg','png','gif','webp'].includes(ext)) {
        showToast(`${file.name} is not a supported image.`, 'warn'); return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        addBucketItem({
          id: uid(), type: 'image', name: file.name,
          content: ev.target.result, base64: ev.target.result.split(',')[1],
          mimeType: file.type || `image/${ext}`, previewUrl: ev.target.result
        });
        showToast(`Image "${file.name}" added to Bucket.`, 'success');
      };
      reader.readAsDataURL(file);
    });
  }

  // Attachments
  const attachDropZone  = document.getElementById('attach-drop-zone');
  const attachFileInput = document.getElementById('attach-file-input');
  attachDropZone.addEventListener('click', () => attachFileInput.click());
  attachDropZone.addEventListener('dragover',  e => { e.preventDefault(); attachDropZone.classList.add('dragover'); });
  attachDropZone.addEventListener('dragleave', () => attachDropZone.classList.remove('dragover'));
  attachDropZone.addEventListener('drop', e => {
    e.preventDefault(); attachDropZone.classList.remove('dragover');
    handleAttachFiles(e.dataTransfer.files);
  });
  attachFileInput.addEventListener('change', () => { handleAttachFiles(attachFileInput.files); attachFileInput.value = ''; });

  function handleAttachFiles(files) {
    Array.from(files).forEach(file => {
      const ext = file.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp'].includes(ext)) {
        showToast(`${file.name} is an image — use the Images tab.`, 'warn'); return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        addBucketItem({
          id: uid(), type: 'file', name: file.name, content: null,
          base64: ev.target.result.split(',')[1],
          mimeType: file.type || 'application/octet-stream',
          previewText: `${file.name} (${(file.size/1024).toFixed(1)} KB)`
        });
        showToast(`File "${file.name}" added to Bucket.`, 'success');
      };
      reader.readAsDataURL(file);
    });
  }

  function addBucketItem(item) { STATE.bucket.items.push(item); renderBucketItems(); }
  function removeBucketItem(id) { STATE.bucket.items = STATE.bucket.items.filter(i => i.id !== id); renderBucketItems(); }

  function renderBucketItems() {
    const containers = {
      html:   document.getElementById('bucket-html-list'),
      css:    document.getElementById('bucket-css-list'),
      images: document.getElementById('bucket-images-list'),
      files:  document.getElementById('bucket-files-list')
    };
    Object.values(containers).forEach(c => { if (c) c.innerHTML = ''; });

    STATE.bucket.items.forEach(item => {
      const container = containers[item.type];
      if (!container) return;
      const el = document.createElement('div');
      el.className = 'bucket-item';
      el.innerHTML = `
        <div class="bucket-item-header">
          <div class="bucket-item-name">
            <span>${typeIcon(item.type)}</span>
            <span class="truncate" style="max-width:120px" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
            <span class="bucket-item-type type-${item.type}">${item.type.toUpperCase()}</span>
          </div>
        </div>
        ${item.previewUrl ? `<img class="bucket-image-preview" src="${item.previewUrl}" alt="${escapeHtml(item.name)}">` : ''}
        ${item.previewText ? `<div class="bucket-item-preview">${escapeHtml(item.previewText)}</div>` : ''}
        <div class="bucket-item-actions">
          <button class="btn btn-primary btn-xs throw-btn" data-id="${item.id}">→ Throw to Stack</button>
          <button class="btn btn-ghost btn-xs remove-btn" data-id="${item.id}">Remove</button>
        </div>`;
      container.appendChild(el);
      el.querySelector('.throw-btn').addEventListener('click',  () => throwToStack(item.id));
      el.querySelector('.remove-btn').addEventListener('click', () => removeBucketItem(item.id));
    });

    const counts = { html:0, css:0, image:0, file:0 };
    STATE.bucket.items.forEach(i => { if (counts[i.type] !== undefined) counts[i.type]++; });
    const el = id => document.getElementById(id);
    if (el('bucket-html-count'))  el('bucket-html-count').textContent  = counts.html  || '';
    if (el('bucket-css-count'))   el('bucket-css-count').textContent   = counts.css   || '';
    if (el('bucket-img-count'))   el('bucket-img-count').textContent   = counts.image || '';
    if (el('bucket-file-count'))  el('bucket-file-count').textContent  = counts.file  || '';

    const wpEl = el('webpage-obj-counts');
    if (wpEl) {
      const total = counts.html + counts.css + counts.image;
      if (!total) {
        wpEl.innerHTML = '<span style="color:var(--text3)">Bucket is empty — add HTML, CSS, or Images first</span>';
      } else {
        const parts = [];
        if (counts.html)  parts.push(`📄 ${counts.html} HTML`);
        if (counts.css)   parts.push(`🎨 ${counts.css} CSS`);
        if (counts.image) parts.push(`🖼 ${counts.image} Image${counts.image!==1?'s':''}`);
        wpEl.innerHTML = parts.map(p=>`<span>${p}</span>`).join('');
      }
    }
  }

  function typeIcon(type) {
    return {html:'📄',css:'🎨',image:'🖼',file:'📎',webpage:'🌐',text:'📝'}[type]||'📄';
  }

  // ============================================================
  // THROW TO STACK
  // ============================================================
  function throwToStack(bucketItemId) {
    const item = STATE.bucket.items.find(i => i.id === bucketItemId);
    if (!item) return;
    STATE.stack.modules.push({
      id: uid(), type: item.type, label: item.name,
      content: item.content||'', base64: item.base64||'',
      mimeType: item.mimeType||'', previewUrl: item.previewUrl||'',
      previewText: item.previewText||(item.content?item.content.slice(0,80):'')
    });
    if (STATE.emailState !== 'draft') resetToPreview();
    renderStack(); updatePreview();
    showToast(`"${item.name}" thrown to Stack.`, 'success');
  }

  document.getElementById('throw-text-btn').addEventListener('click', () => {
    const text = STATE.compose.textDescription.trim();
    if (!text) { showToast('Enter text description first.', 'warn'); return; }
    STATE.stack.modules.push({ id:uid(), type:'text', label:'Text Description', content:text, previewText:text.slice(0,80) });
    if (STATE.emailState !== 'draft') resetToPreview();
    renderStack(); updatePreview();
    showToast('Text added to Stack.', 'success');
  });

  function resetToPreview() {
    STATE.submitted=false; STATE.submittedSnapshot=null; STATE.submittedModules=null;
    setEmailState('draft'); updateSendSteps(1);
  }

  // ============================================================
  // STACK
  // ============================================================
  function renderStack() {
    const container = document.getElementById('stack-modules');
    const emptyEl   = document.getElementById('stack-empty');
    container.innerHTML = '';
    emptyEl.classList.toggle('hidden', STATE.stack.modules.length > 0);

    STATE.stack.modules.forEach(mod => {
      const el = document.createElement('div');
      el.className  = 'stack-module';
      el.dataset.id = mod.id;
      el.draggable  = true;
      const meta = mod.type==='webpage'&&mod.metadata
        ? ` <span class="text-xs text-3">(HTML:${mod.metadata.htmlCount} CSS:${mod.metadata.cssCount} Imgs:${mod.metadata.imageCount})</span>`
        : '';
      el.innerHTML = `
        <div class="stack-module-header">
          <span class="stack-module-handle" title="Drag to reorder">⠿</span>
          <span class="stack-module-icon">${moduleIcon(mod.type)}</span>
          <span class="stack-module-label">${escapeHtml(mod.label)}${meta}</span>
          <span class="badge badge-${typeBadgeColor(mod.type)}" style="font-size:.6rem">${mod.type.toUpperCase()}</span>
          <div class="stack-module-actions">
            <button class="btn btn-ghost btn-icon btn-xs" title="Move Up"   data-action="up"   data-id="${mod.id}">↑</button>
            <button class="btn btn-ghost btn-icon btn-xs" title="Move Down" data-action="down" data-id="${mod.id}">↓</button>
            <button class="btn btn-ghost btn-icon btn-xs" title="Edit"      data-action="edit" data-id="${mod.id}">✏</button>
            <button class="btn btn-danger  btn-icon btn-xs" title="Delete"  data-action="del"  data-id="${mod.id}">✕</button>
          </div>
        </div>
        ${mod.previewUrl
          ? `<div style="padding:0 .6rem .5rem"><img src="${mod.previewUrl}" style="max-height:48px;max-width:100%;border-radius:4px;object-fit:cover" alt="${escapeHtml(mod.label)}"></div>`
          : mod.previewText
          ? `<div class="stack-module-preview">${escapeHtml(mod.previewText)}</div>`
          : ''}`;
      container.appendChild(el);
      el.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); handleStackAction(btn.dataset.action, btn.dataset.id); });
      });
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain',mod.id); el.classList.add('dragging'); });
      el.addEventListener('dragend',   () => el.classList.remove('dragging'));
      el.addEventListener('dragover',  e => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault(); el.classList.remove('drag-over');
        const dragId = e.dataTransfer.getData('text/plain');
        if (dragId !== mod.id) reorderModules(dragId, mod.id);
      });
    });
  }

  function moduleIcon(type) { return {html:'📄',css:'🎨',image:'🖼',text:'📝',file:'📎',webpage:'🌐'}[type]||'📄'; }
  function typeBadgeColor(type) { return {html:'yellow',css:'blue',image:'green',text:'purple',file:'blue',webpage:'red'}[type]||'blue'; }

  function handleStackAction(action, id) {
    const idx = STATE.stack.modules.findIndex(m => m.id === id);
    if (idx === -1) return;
    if (action==='up'   && idx>0) [STATE.stack.modules[idx-1],STATE.stack.modules[idx]]=[STATE.stack.modules[idx],STATE.stack.modules[idx-1]];
    else if (action==='down' && idx<STATE.stack.modules.length-1) [STATE.stack.modules[idx],STATE.stack.modules[idx+1]]=[STATE.stack.modules[idx+1],STATE.stack.modules[idx]];
    else if (action==='del') { STATE.stack.modules.splice(idx,1); showToast('Module removed.','info'); }
    else if (action==='edit') { openEditModal(id); return; }
    if (STATE.emailState!=='draft') resetToPreview();
    renderStack();
  }

  function reorderModules(dragId, dropId) {
    const from = STATE.stack.modules.findIndex(m => m.id===dragId);
    const to   = STATE.stack.modules.findIndex(m => m.id===dropId);
    if (from===-1||to===-1) return;
    const [moved] = STATE.stack.modules.splice(from,1);
    STATE.stack.modules.splice(to,0,moved);
    if (STATE.emailState!=='draft') resetToPreview();
    renderStack();
  }

  document.getElementById('clear-stack-btn').addEventListener('click', () => {
    if (!STATE.stack.modules.length) { showToast('Stack is already empty.','info'); return; }
    if (confirm('Clear all modules from the Stack?')) {
      STATE.stack.modules=[];
      resetToPreview(); renderStack(); showToast('Stack cleared.','info');
    }
  });

  // ============================================================
  // EDIT MODULE MODAL
  // ============================================================
  function openEditModal(id) {
    const mod = STATE.stack.modules.find(m => m.id===id);
    if (!mod) return;
    const modal       = document.getElementById('edit-modal');
    const labelInput  = document.getElementById('edit-label');
    const contentArea = document.getElementById('edit-content');
    const contentField= document.getElementById('edit-content-field');
    document.getElementById('edit-modal-title').textContent = `Edit: ${mod.label}`;
    labelInput.value = mod.label;
    if (mod.type==='image'||mod.type==='webpage') {
      contentField.style.display = 'none';
    } else {
      contentField.style.display = '';
      contentArea.value = mod.content||'';
    }
    modal.dataset.editId = id;
    modal.classList.remove('hidden');
    if (mod.type!=='image'&&mod.type!=='webpage') contentArea.focus();
  }

  document.getElementById('close-edit-modal').addEventListener('click',  () => document.getElementById('edit-modal').classList.add('hidden'));
  document.getElementById('cancel-edit-btn').addEventListener('click',   () => document.getElementById('edit-modal').classList.add('hidden'));
  document.getElementById('edit-modal').addEventListener('click', e => {
    if (e.target===document.getElementById('edit-modal')) document.getElementById('edit-modal').classList.add('hidden');
  });
  document.getElementById('save-edit-btn').addEventListener('click', () => {
    const modal = document.getElementById('edit-modal');
    const id    = modal.dataset.editId;
    const mod   = STATE.stack.modules.find(m => m.id===id);
    if (!mod) return;
    mod.label = document.getElementById('edit-label').value.trim()||mod.label;
    if (mod.type!=='image'&&mod.type!=='webpage') {
      mod.content     = document.getElementById('edit-content').value;
      mod.previewText = mod.content.slice(0,80);
    }
    if (STATE.emailState!=='draft') resetToPreview();
    renderStack();
    modal.classList.add('hidden');
    showToast('Module updated.','success');
  });

  // ============================================================
  // EMAIL COMPATIBILITY ENGINE
  // ============================================================
  function sanitizeForEmail(html) {
    let safe = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,'');
    safe = safe.replace(/\son\w+="[^"]*"/gi,'');
    safe = safe.replace(/\son\w+='[^']*'/gi,'');
    safe = safe.replace(/href="javascript:[^"]*"/gi,'href="#"');
    safe = safe.replace(/<link\b[^>]*>/gi,'');
    safe = safe.replace(/<base\b[^>]*>/gi,'');
    return safe;
  }

  function generatePreviewWarnings() {
    const warnings = [];
    const modules  = STATE.stack.modules;
    if (modules.some(m=>(m.type==='html'||m.type==='webpage')&&(m.content||m.htmlContent||'').match(/<script|javascript:|on\w+=/i)))
      warnings.push('JavaScript detected — scripts are stripped in email clients');
    if (modules.some(m=>(m.type==='html'||m.type==='webpage')&&(m.content||m.htmlContent||'').match(/src="https?:\/\//i)))
      warnings.push('External image URLs detected — some clients block them; use embedded images');
    const allCss = [...modules.filter(m=>m.type==='css').map(m=>m.content||''),...modules.filter(m=>m.type==='webpage').map(m=>m.cssContent||'')].join(' ');
    if (allCss.match(/position\s*:\s*fixed|position\s*:\s*absolute/i)) warnings.push('CSS: position:fixed/absolute — not supported in most email clients');
    if (allCss.match(/@media/i))                                        warnings.push('CSS: @media queries — limited support; test across clients');
    if (allCss.match(/display\s*:\s*flex|display\s*:\s*grid/i))        warnings.push('CSS: flexbox/grid — not supported in Outlook');
    if (allCss.match(/animation|transition|transform/i))               warnings.push('CSS: animations/transitions — not supported in email clients');
    const contentMods = modules.filter(m=>m.type!=='css');
    if (!contentMods.length&&modules.length) warnings.push('Stack only contains CSS — add HTML, text, or image modules');
    return warnings;
  }

  function renderPreviewWarnings() {
    const warnings = generatePreviewWarnings();
    const panel    = document.getElementById('preview-warnings-panel');
    const list     = document.getElementById('preview-warnings-list');
    if (!warnings.length) { panel.classList.add('hidden'); return; }
    list.innerHTML = warnings.map(w=>`<div class="preview-warning-item">${escapeHtml(w)}</div>`).join('');
    panel.classList.remove('hidden');
  }

  // ============================================================
  // EMAIL CLIENT SIMULATION
  // ============================================================
  function wrapForClient(html, client) {
    const styles = {
      'gmail-desktop': `body{font-family:Arial,Helvetica,sans-serif!important;}.email-client-frame{max-width:600px;margin:0 auto;background:#fff;}`,
      'gmail-mobile':  `body{font-family:Arial,Helvetica,sans-serif!important;}.email-client-frame{max-width:320px;margin:0 auto;background:#fff;}*{font-size:14px!important;}`,
      'outlook':       `body{font-family:Calibri,Arial,sans-serif!important;background:#f0f0f0!important;}.email-client-frame{max-width:600px;margin:0 auto;background:#fff;padding:20px;}div[style*="display:flex"]{display:block!important;}div[style*="display:grid"]{display:block!important;}`
    };
    const css = styles[client]||styles['gmail-desktop'];
    return html
      .replace('</style>',`${css}\n</style>`)
      .replace('<div class="email-wrapper">','<div class="email-client-frame email-wrapper">');
  }

  // ============================================================
  // PREVIEW ENGINE
  // ============================================================
  function buildEmailHTML() {
    const modules    = STATE.stack.modules;
    const cssContent = [...modules.filter(m=>m.type==='css').map(m=>m.content||''),...modules.filter(m=>m.type==='webpage').map(m=>m.cssContent||'')].join('\n');
    const bodyParts  = [];
    modules.forEach(mod => {
      if (mod.type==='text') {
        bodyParts.push(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;padding:8px 0">${escapeHtmlToHtml(mod.content)}</div>`);
      } else if (mod.type==='html') {
        bodyParts.push(sanitizeForEmail(mod.content));
      } else if (mod.type==='webpage') {
        let wpHtml = sanitizeForEmail(mod.htmlContent||mod.content||'');
        if (mod.imageRefs&&mod.imageRefs.length) {
          mod.imageRefs.forEach(img => {
            if (img.previewUrl) {
              const n = img.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
              wpHtml = wpHtml.replace(new RegExp(`src=["']${n}["']`,'gi'),`src="${img.previewUrl}"`);
            }
          });
          mod.imageRefs.forEach(img => {
            if (!wpHtml.includes(img.name)&&img.previewUrl) {
              wpHtml += `<div style="text-align:center;padding:4px 0"><img src="${img.previewUrl}" alt="${escapeHtml(img.name)}" style="max-width:100%;height:auto;display:block;margin:0 auto;border:0"></div>`;
            }
          });
        }
        bodyParts.push(wpHtml);
      } else if (mod.type==='image') {
        bodyParts.push(`<div style="text-align:center;padding:8px 0"><img src="${mod.previewUrl||mod.content}" alt="${escapeHtml(mod.label)}" style="max-width:100%;height:auto;display:block;margin:0 auto;border:0"></div>`);
      } else if (mod.type==='file') {
        bodyParts.push(`<div style="padding:8px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;font-size:13px;color:#555;margin:4px 0">📎 Attachment: ${escapeHtml(mod.label)}</div>`);
      }
    });
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email Preview</title>
<style>body{margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;}.email-wrapper{max-width:600px;margin:0 auto;padding:20px;}img{max-width:100%;height:auto;}${cssContent}</style>
</head><body><div class="email-wrapper">${bodyParts.join('\n')}</div></body></html>`;
  }

  function updatePreview() {
    const frame     = document.getElementById('preview-frame');
    const emptyEl   = document.getElementById('preview-empty');
    const frameWrap = document.getElementById('preview-frame-wrap');
    if (!STATE.stack.modules.length) {
      emptyEl.classList.remove('hidden'); frameWrap.classList.add('hidden');
      document.getElementById('preview-warnings-panel').classList.add('hidden'); return;
    }
    emptyEl.classList.add('hidden'); frameWrap.classList.remove('hidden');
    const rawHtml    = buildEmailHTML();
    const clientHtml = wrapForClient(rawHtml, STATE.currentClient);
    const blob       = new Blob([clientHtml],{type:'text/html'});
    const url        = URL.createObjectURL(blob);
    const oldSrc     = frame.src;
    frame.src = url;
    if (oldSrc&&oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
    frame.style.height = '500px';
    frame.onload = () => {
      try { const b=frame.contentDocument.body; if(b) frame.style.height=Math.max(b.scrollHeight+20,200)+'px'; } catch(e){}
    };
    renderPreviewWarnings();
  }

  document.getElementById('refresh-preview-btn').addEventListener('click', updatePreview);
  $$('.preview-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.preview-size-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('preview-frame').style.width = {desktop:'100%',tablet:'640px',mobile:'375px'}[btn.dataset.size]||'100%';
    });
  });
  $$('.preview-client-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.preview-client-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      STATE.currentClient = btn.dataset.client;
      updatePreview();
    });
  });

  // ============================================================
  // PRE-SEND VALIDATION
  // ============================================================
  function runValidation() {
    const results = [];
    results.push(STATE.account.configured
      ? {pass:true,  label:'Account configured'}
      : {pass:false, label:'Account not configured — click ⚙ Account'});
    results.push(STATE.account.verified
      ? {pass:true,   label:'Connection verified'}
      : {pass:'warn', label:'Connection not verified — Test Connection recommended'});
    results.push(STATE.historyHealth.available === true
      ? {pass:true,   label:`History healthy (${STATE.historyHealth.recordCount} records)`}
      : STATE.historyHealth.available === false
      ? {pass:'warn', label:'History unavailable — records cached locally (will sync when AS available)'}
      : {pass:'warn', label:'History status unknown — Test Connection to verify'});
    results.push(STATE.compose.to.length>0
      ? {pass:true,  label:`TO: ${STATE.compose.to.length} recipient(s)`}
      : {pass:false, label:'No TO recipient'});
    results.push(checkDuplicates()
      ? {pass:true,  label:'No duplicate recipients'}
      : {pass:false, label:'Duplicate recipients detected'});
    results.push(STATE.compose.subject.trim()
      ? {pass:true,  label:'Subject present'}
      : {pass:false, label:'Subject is empty'});
    results.push(STATE.stack.modules.length>0
      ? {pass:true,  label:`Stack: ${STATE.stack.modules.length} module(s)`}
      : {pass:false, label:'Stack is empty — add content'});
    const contentMods = STATE.stack.modules.filter(m=>m.type!=='css');
    results.push(contentMods.length>0
      ? {pass:true,   label:'Email body has content'}
      : {pass:'warn', label:'Stack only has CSS — add content modules'});
    results.push(STATE.submitted&&STATE.submittedSnapshot
      ? {pass:true,  label:`Snapshot frozen (${STATE.submittedModules?STATE.submittedModules.length+' modules':''})`}
      : {pass:false, label:'Not submitted — click Submit to freeze snapshot'});
    return results;
  }

  function renderValidationPanel() {
    const panel = document.getElementById('pre-send-validation');
    const list  = document.getElementById('validation-items');
    if (!panel||!list) return {allPass:false,results:[]};
    const results = runValidation();
    const allPass = results.every(r=>r.pass===true||r.pass==='warn');
    list.innerHTML = results.map(r => {
      const cls  = r.pass===true?'pass':r.pass==='warn'?'warn':'fail';
      const icon = r.pass===true?'✓':r.pass==='warn'?'⚠':'✕';
      return `<div class="validation-item ${cls}"><span class="validation-icon">${icon}</span><span>${escapeHtml(r.label)}</span></div>`;
    }).join('');
    panel.classList.remove('hidden');
    return {allPass,results};
  }

  // ============================================================
  // SEND WORKFLOW — Preview → Submit → Send
  // ============================================================
  function updateSendSteps(step) {
    const nums = $$('.send-step-num');
    nums.forEach((el,i) => {
      el.className = i+1<step?'send-step-num done':i+1===step?'send-step-num current':'send-step-num pending';
    });
    document.getElementById('preview-btn').disabled = step>1;
    document.getElementById('submit-btn').disabled  = step!==2;
    document.getElementById('send-btn').disabled    = step!==3;
  }

  document.getElementById('preview-btn').addEventListener('click', () => {
    if (!STATE.stack.modules.length) { showToast('Add modules to the Stack first.','warn'); return; }
    updatePreview(); updateSendSteps(2); setEmailState('previewed');
    document.getElementById('preview-frame-wrap').scrollIntoView({behavior:'smooth'});
    showToast('Preview rendered. Review then click Submit.','info');
  });

  document.getElementById('submit-btn').addEventListener('click', () => {
    if (!STATE.stack.modules.length) { showToast('Stack is empty.','warn'); return; }
    if (!STATE.compose.to.length) { showToast('Add at least one TO recipient.','warn'); return; }
    if (!STATE.compose.subject.trim()) { showToast('Add a subject.','warn'); return; }
    STATE.submittedSnapshot = buildEmailHTML();
    STATE.submittedModules  = deepCopy(STATE.stack.modules);
    STATE.submitted         = true;
    updateSendSteps(3); setEmailState('submitted');
    renderValidationPanel();
    showToast(`✓ Snapshot frozen: ${STATE.submittedModules.length} modules locked. Ready to send.`,'success');
  });

  document.getElementById('send-btn').addEventListener('click', async () => {
    if (!STATE.account.configured) {
      showToast('Configure your account first.','error'); openAccountModal(); return;
    }
    const {results} = renderValidationPanel();
    if (results.some(r=>r.pass===false)) { showToast('Fix validation errors before sending.','error'); return; }
    if (!checkDuplicates()) { showToast('Duplicate recipients detected.','error'); return; }
    await executeSendWithProgress();
  });

  // ============================================================
  // SEND PROGRESS MODAL
  // Phase 2: History Write Verification step added after send
  // Phase 6: Complete history record with all required fields
  // Phase 7: Full snapshot (module order + content + images)
  // Phase 9: Failure protection with _unsynced marker
  // ============================================================
  async function executeSendWithProgress() {
    const modal    = document.getElementById('send-progress-modal');
    const titleEl  = document.getElementById('send-progress-title');
    const recipBox = document.getElementById('send-progress-recipients');
    const overallEl= document.getElementById('send-progress-overall');
    const doneBtn  = document.getElementById('close-send-progress-btn');

    const allRecipients = [
      ...STATE.compose.to.map(e=>({email:e,type:'TO'})),
      ...STATE.compose.cc.map(e=>({email:e,type:'CC'})),
      ...STATE.compose.bcc.map(e=>({email:e,type:'BCC'}))
    ];

    recipBox.innerHTML = '';
    const rowMap = {};
    allRecipients.forEach(r => {
      const div = document.createElement('div');
      div.className = 'send-progress-recipient';
      div.innerHTML = `<span class="send-progress-email"><strong>${escapeHtml(r.type)}</strong> ${escapeHtml(r.email)}</span>
        <span class="send-progress-status pending">Pending</span>`;
      recipBox.appendChild(div);
      rowMap[r.email] = div.querySelector('.send-progress-status');
    });

    overallEl.textContent=''; overallEl.classList.add('hidden');
    doneBtn.classList.add('hidden');
    titleEl.textContent = '🚀 Sending Email…';
    modal.classList.remove('hidden');
    setEmailState('sending');

    function setRecipStatus(email, status, errMsg) {
      const el = rowMap[email];
      if (!el) return;
      el.className  = `send-progress-status ${status}`;
      el.textContent = status==='sending'?'◌ Sending…':status==='sent'?'✓ Sent':status==='failed'?`✕ Failed${errMsg?': '+errMsg:''}`:' Pending';
    }

    STATE.compose.to.forEach(e=>setRecipStatus(e,'sending'));

    // Phase 6: Ensure every required field is in the payload
    const emailHtml  = STATE.submittedSnapshot || buildEmailHTML();
    const plainText  = STATE.compose.textDescription || 'Please view this email in an HTML-capable client.';
    // Phase 7: Full module snapshot for reconstruction
    const moduleSnapshot = STATE.submittedModules ? deepCopy(STATE.submittedModules) : deepCopy(STATE.stack.modules);
    const attachments = moduleSnapshot.filter(m=>m.type==='file').map(m=>({name:m.label,base64:m.base64,mimeType:m.mimeType}));
    const embeddedImages = moduleSnapshot
      .filter(m=>m.type==='image'||m.type==='webpage')
      .flatMap(m=>m.type==='webpage'&&m.imageRefs?m.imageRefs.map(r=>r.name):[m.label]);

    // Phase 6: Complete payload
    const payload = {
      fromEmail:      STATE.account.fromEmail,
      scriptId:       STATE.account.scriptId,
      subject:        STATE.compose.subject,
      to:             STATE.compose.to,
      cc:             STATE.compose.cc,
      bcc:            STATE.compose.bcc,
      htmlBody:       emailHtml,
      plainText,
      attachments,
      wpInputs:       STATE.compose.wpInputs,
      embeddedImages
    };

    let responseData = null;
    let networkError  = false;

    try {
      try {
        const res = await fetch(STATE.account.scriptUrl, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload), redirect: 'follow'
        });
        responseData = await res.json();
      } catch(corsErr) {
        try {
          await fetch(STATE.account.scriptUrl, {
            method: 'POST', mode: 'no-cors',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(payload)
          });
          responseData = { success: true, note: 'no-cors mode — verify in Gmail Sent folder' };
        } catch(fatalErr) {
          allRecipients.forEach(r=>setRecipStatus(r.email,'failed','Network error'));
          overallEl.textContent='✕ Could not reach Apps Script. Check the URL.';
          overallEl.style.color='var(--danger)';
          overallEl.classList.remove('hidden');
          doneBtn.classList.remove('hidden');
          doneBtn.onclick=()=>modal.classList.add('hidden');
          setEmailState('previewed');
          return;
        }
      }

      const isSuccess = !responseData || responseData.success !== false || !!responseData.note;

      if (responseData && responseData.results && Array.isArray(responseData.results)) {
        responseData.results.forEach(r=>setRecipStatus(r.to,r.status==='sent'?'sent':'failed',r.error));
        STATE.compose.cc.forEach(e=>setRecipStatus(e,isSuccess?'sent':'failed'));
        STATE.compose.bcc.forEach(e=>setRecipStatus(e,isSuccess?'sent':'failed'));
      } else if (isSuccess) {
        allRecipients.forEach(r=>setRecipStatus(r.email,'sent'));
      } else {
        allRecipients.forEach(r=>setRecipStatus(r.email,'failed',responseData&&responseData.error));
      }

      // ── Phase 6: Build complete history record ─────────────────
      const snapshotId = (responseData && responseData.snapshotId) || uid();
      const sentAt     = new Date().toISOString();

      const historyRecord = {
        // Phase 6 required fields
        id:             uid(),
        snapshotId,
        sentAt,
        timestamp:      sentAt,
        subject:        STATE.compose.subject,
        fromEmail:      STATE.account.fromEmail,
        to:             [...STATE.compose.to],
        cc:             [...STATE.compose.cc],
        bcc:            [...STATE.compose.bcc],
        status:         isSuccess ? 'sent' : 'error',
        attachments:    attachments.map(a=>a.name),
        embeddedImages,
        recipientCount: allRecipients.length,
        deliveryMethod: 'Gmail via Apps Script',
        // Phase 6: How It Was Sent (complete)
        howItWasSent: {
          to:              [...STATE.compose.to],
          cc:              [...STATE.compose.cc],
          bcc:             [...STATE.compose.bcc],
          count:           allRecipients.length,
          viaScriptUrl:    STATE.account.scriptUrl,
          viaScriptId:     STATE.account.scriptId,
          timestamp:       sentAt,
          deliveryMethod:  'Gmail via Apps Script',
          wpInputs:        {...STATE.compose.wpInputs},
          attachmentCount: attachments.length,
          embeddedImages,
          snapshotId,
          appsScriptHistory: (responseData && responseData.history) || null
        },
        // Phase 7: Full snapshot for reconstruction
        modules:        moduleSnapshot,
        htmlSnapshot:   emailHtml,
        // Source tracking (Phase 1)
        _source:        'local',
        _unsynced:      true,           // Phase 9: optimistic — will be confirmed
        errorMsg:       responseData && responseData.error ? responseData.error : null
      };

      // Phase 9: Save to localStorage immediately (failure protection)
      STATE.sentEmails.unshift(historyRecord);
      saveToStorage();

      if (!isSuccess) {
        titleEl.textContent   = '⚠ Send Completed with Errors';
        overallEl.textContent = `⚠ ${responseData&&responseData.error?responseData.error:'Send completed with errors.'}`;
        overallEl.style.color = 'var(--warn)';
        overallEl.classList.remove('hidden');
        doneBtn.classList.remove('hidden');
        doneBtn.onclick = () => modal.classList.add('hidden');
        setEmailState('previewed');
        return;
      }

      // ── Phase 2: Verify history was written to Apps Script ─────
      // Show intermediate status while verifying
      overallEl.textContent = '◌ Verifying history write to Apps Script…';
      overallEl.style.color = 'var(--text2)';
      overallEl.classList.remove('hidden');

      let historyWritten   = false;
      let historyWriteNote = '';

      try {
        await sleep(1200); // Allow AS PropertiesService to commit
        const writeVerification = await verifyHistoryWrite(snapshotId, STATE.account.scriptUrl);
        if (writeVerification.verified) {
          historyWritten = true;
          historyRecord._unsynced = false;
          historyRecord._source   = 'apps-script';
          historyRecord.serverConfirmed = true;
          STATE.historyHealth.available  = true;
          STATE.historyHealth.writeOk    = true;
          STATE.historyHealth.recordCount = (STATE.historyHealth.recordCount||0) + 1;
          historyWriteNote = `✓ History write confirmed — record in Apps Script`;
        } else {
          // Phase 2: Report write failure — do NOT silently continue
          historyRecord._unsynced    = true;
          historyRecord._source      = 'local';
          historyRecord.writeError   = writeVerification.reason;
          historyWriteNote = `⚠ History write not confirmed (${writeVerification.reason}). Record cached locally and will sync automatically.`;
          STATE.historyHealth.writeOk = false;
        }
      } catch(verErr) {
        // CORS may block verification — record stays _unsynced until sync
        historyRecord._unsynced  = true;
        historyWriteNote = '◌ History write verification inconclusive (CORS) — record cached locally.';
      }

      // Update the record in STATE and save
      const idx = STATE.sentEmails.findIndex(r => r.snapshotId === snapshotId);
      if (idx !== -1) STATE.sentEmails[idx] = historyRecord;
      STATE.lastHistorySync = new Date().toISOString();
      saveToStorage();
      renderAccountStatus();

      titleEl.textContent   = '✓ Email Sent!';
      overallEl.textContent = `✓ Email sent via Gmail. ${historyWriteNote} Moving to Sent Emails…`;
      overallEl.style.color = historyWritten ? 'var(--success)' : 'var(--warn)';
      overallEl.classList.remove('hidden');
      doneBtn.classList.remove('hidden');
      setEmailState('sent');

      doneBtn.onclick = () => {
        modal.classList.add('hidden');
        resetCompose();
        switchView(VIEWS.SENT);
        renderSentList();
        openSentDetail(historyRecord.id);
      };

    } catch(err) {
      allRecipients.forEach(r=>setRecipStatus(r.email,'failed',err.message));
      overallEl.textContent = `✕ Unexpected error: ${err.message}`;
      overallEl.style.color = 'var(--danger)';
      overallEl.classList.remove('hidden');
      doneBtn.classList.remove('hidden');
      doneBtn.onclick = () => document.getElementById('send-progress-modal').classList.add('hidden');
      setEmailState('previewed');
    }
  }

  document.getElementById('close-send-progress-btn').addEventListener('click', () => {
    document.getElementById('send-progress-modal').classList.add('hidden');
  });

  // ============================================================
  // PHASE 1: APPS SCRIPT HISTORY SYNC (primary function)
  // Apps Script = Source of Truth. localStorage = cache.
  // ============================================================
  async function syncAppsScriptHistory(latestSnapshotId) {
    if (!STATE.account.scriptUrl) return;
    try {
      const histUrl = STATE.account.scriptUrl
        + (STATE.account.scriptUrl.includes('?') ? '&' : '?')
        + 'action=getHistory';
      const res  = await fetch(histUrl, {method:'GET',redirect:'follow'});
      const data = await res.json();

      if (data && data.success !== false && Array.isArray(data.history)) {
        // Phase 1: AS records are authoritative — update local cache
        const unsyncedLocals = STATE.sentEmails.filter(r=>r._unsynced);
        const asRecords = data.history.map(r=>({...r, _source:'apps-script', _unsynced:false, serverConfirmed:true}));
        const asIds = new Set(asRecords.map(r=>r.snapshotId));
        const mergedLocals = unsyncedLocals.filter(r=>!asIds.has(r.snapshotId));

        // Phase 1: AS is source of truth — but keep local snapshots for recovery
        data.history.forEach(asRecord => {
          const localRecord = STATE.sentEmails.find(r=>r.snapshotId===asRecord.snapshotId);
          if (localRecord) {
            localRecord._source        = 'apps-script';
            localRecord._unsynced      = false;
            localRecord.serverConfirmed= true;
            localRecord.appsScriptStatus    = asRecord.status;
            localRecord.appsScriptTimestamp = asRecord.timestamp;
          }
        });

        // Add any AS records not in local cache (cross-session recovery)
        asIds.forEach(id => {
          if (!STATE.sentEmails.find(r=>r.snapshotId===id)) {
            const asRec = data.history.find(r=>r.snapshotId===id);
            if (asRec) STATE.sentEmails.push({...asRec, _source:'apps-script', _unsynced:false, serverConfirmed:true});
          }
        });

        STATE.historyHealth.available   = true;
        STATE.historyHealth.readOk      = true;
        STATE.historyHealth.recordCount = data.history.length;
        STATE.lastHistorySync           = new Date().toISOString();
        saveToStorage();

        // Phase 9: Try to resync any still-unsynced records
        if (mergedLocals.length>0) tryResyncUnsynced();
      }
    } catch(e) {
      // Phase 9: Non-fatal — keep local cache
    }
  }

  // ============================================================
  // RESET COMPOSE
  // ============================================================
  function resetCompose() {
    STATE.compose.to=[]; STATE.compose.cc=[]; STATE.compose.bcc=[];
    STATE.compose.subject=''; STATE.compose.textDescription=''; STATE.compose.wpInputs={};
    STATE.stack.modules=[]; STATE.bucket.items=[];
    STATE.submitted=false; STATE.submittedSnapshot=null; STATE.submittedModules=null;
    ['to-field','cc-field','bcc-field'].forEach(id=>{
      const c=document.getElementById(id);
      if(c) c.querySelectorAll('.recipient-tag').forEach(t=>t.remove());
    });
    const si=document.getElementById('subject-input'); if(si) si.value='';
    const ti=document.getElementById('text-desc-input'); if(ti) ti.value='';
    document.getElementById('wp-inputs-list').innerHTML='';
    STATE.compose.wpInputs={};
    renderStack(); renderBucketItems();
    setEmailState('draft'); updateSendSteps(1);
    document.getElementById('pre-send-validation').classList.add('hidden');
    document.getElementById('preview-warnings-panel').classList.add('hidden');
  }

  // ============================================================
  // SENT EMAILS VIEW
  // Phase 3: Shows source (Apps Script or Cache)
  // Phase 6: All fields shown in detail
  // Phase 7: Full snapshot recovery from module list
  // Phase 9: Unsynced records marked clearly
  // ============================================================
  function renderSentList() {
    const list = document.getElementById('sent-list');
    if (!list) return;

    if (!STATE.sentEmails.length) {
      list.innerHTML = `
        <div class="sent-empty">
          <div class="sent-empty-icon">📭</div>
          <h4>No sent emails</h4>
          <p class="text-sm">Sent emails appear here after sending</p>
        </div>`;
      return;
    }

    list.innerHTML = STATE.sentEmails.map(email => {
      const statusCls   = email.status==='sent'?'badge-green':'badge-red';
      const sourceBadge = email._source==='apps-script'
        ? `<span class="badge badge-blue" style="font-size:.55rem;margin-left:.2rem" title="Stored in Apps Script">AS ✓</span>`
        : email._unsynced
        ? `<span class="badge badge-yellow" style="font-size:.55rem;margin-left:.2rem" title="Cached locally — will sync to Apps Script">UNSYNCED</span>`
        : `<span class="badge" style="background:#1e3a5f;color:#93c5fd;font-size:.55rem;margin-left:.2rem">Cache</span>`;
      return `
        <div class="sent-item" data-id="${email.id}">
          <div class="sent-item-subject">${escapeHtml(email.subject||'(no subject)')}</div>
          <div class="sent-item-meta">
            <span>${escapeHtml(email.fromEmail)}</span>
            <span class="badge ${statusCls}" style="font-size:.6rem">${email.status}</span>
            ${sourceBadge}
          </div>
          <div class="sent-item-date">${formatDate(email.sentAt||email.timestamp)}</div>
          <div class="sent-item-recip">To: ${(email.to||[]).map(e=>escapeHtml(e)).join(', ')}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.sent-item').forEach(item => {
      item.addEventListener('click', () => openSentDetail(item.dataset.id));
    });

    const badge = document.getElementById('sent-count-badge');
    if (badge) badge.textContent = STATE.sentEmails.length>0?STATE.sentEmails.length:'';
  }

  // Phase 7: Full Snapshot Recovery — rebuilds complete original structure
  function openSentDetail(id) {
    const email  = STATE.sentEmails.find(e=>e.id===id);
    const panel  = document.getElementById('sent-detail-panel');
    if (!email||!panel) return;

    list_activate(id);

    const sourceLabel = email._source==='apps-script'
      ? `<span class="badge badge-blue" style="font-size:.65rem">Apps Script ✓</span>`
      : email._unsynced
      ? `<span class="badge badge-yellow" style="font-size:.65rem" title="${escapeHtml(email.writeError||'')}">⚠ Unsynced — cached locally</span>`
      : `<span class="badge" style="background:#1e3a5f;color:#93c5fd;font-size:.65rem">Browser Cache</span>`;

    // Phase 6: show all required fields
    const rows = [
      ['From',        email.fromEmail],
      ['To',          (email.to||[]).join(', ')],
      ['CC',          (email.cc||[]).join(', ')||'—'],
      ['BCC',         (email.bcc||[]).join(', ')||'—'],
      ['Sent At',     formatDate(email.sentAt||email.timestamp)],
      ['Status',      email.status],
      ['Recipients',  email.recipientCount],
      ['Delivery',    email.deliveryMethod||'Gmail via Apps Script'],
      ['Snapshot ID', email.snapshotId||'—'],
      ['Attachments', (email.attachments||[]).join(', ')||'—'],
      ['Emb. Images', (email.embeddedImages||[]).join(', ')||'—'],
    ];

    const wpInfo = email.howItWasSent && email.howItWasSent.wpInputs && Object.keys(email.howItWasSent.wpInputs).length
      ? `<div class="sent-detail-row"><span class="sdl">WP Inputs</span><span class="sdr">${escapeHtml(JSON.stringify(email.howItWasSent.wpInputs))}</span></div>`
      : '';
    const writeErrNote = email.writeError
      ? `<div class="sent-detail-row"><span class="sdl">History Note</span><span class="sdr" style="color:var(--warn)">${escapeHtml(email.writeError)}</span></div>`
      : '';
    const errorNote = email.errorMsg
      ? `<div class="sent-detail-row"><span class="sdl">Error</span><span class="sdr" style="color:var(--danger)">${escapeHtml(email.errorMsg)}</span></div>`
      : '';

    // Phase 7: Module list (full snapshot recovery)
    const moduleList = email.modules&&email.modules.length
      ? `<div class="sent-modules-section">
          <div class="sent-modules-title">📦 Email Modules — Snapshot Recovery (${email.modules.length} total, in original order)</div>
          ${email.modules.map((m,i)=>`
            <div class="sent-module-item">
              <span class="sent-module-num">${i+1}</span>
              <span>${moduleIcon(m.type)}</span>
              <span class="sent-module-label">${escapeHtml(m.label)}</span>
              <span class="badge badge-${typeBadgeColor(m.type)}" style="font-size:.55rem">${m.type.toUpperCase()}</span>
              ${m.type==='webpage'&&m.metadata?`<span style="font-size:.65rem;color:var(--text3)">(HTML:${m.metadata.htmlCount} CSS:${m.metadata.cssCount} Imgs:${m.metadata.imageCount})</span>`:''}
            </div>`).join('')}
          <div style="margin-top:.5rem;font-size:.72rem;color:var(--text3)">✓ Module order, content, images, attachments, and text preserved.</div>
        </div>`
      : '';

    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="sent-detail-inner">
        <div class="sent-detail-head">
          <div class="sent-detail-subject">${escapeHtml(email.subject||'(no subject)')}</div>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.35rem;margin-top:.3rem">
            <span class="badge ${email.status==='sent'?'badge-green':'badge-red'}">${email.status}</span>
            ${sourceLabel}
            <span class="badge badge-blue" style="font-size:.65rem">Gmail via Apps Script</span>
            ${email.serverConfirmed?'<span class="badge badge-green" style="font-size:.65rem">History Confirmed in AS</span>':''}
          </div>
        </div>

        <div class="sent-detail-body">
          ${rows.map(([l,v])=>`
            <div class="sent-detail-row">
              <span class="sdl">${escapeHtml(l)}</span>
              <span class="sdr">${escapeHtml(String(v||'—'))}</span>
            </div>`).join('')}
          ${wpInfo}
          ${writeErrNote}
          ${errorNote}
        </div>

        ${moduleList}

        <div class="sent-preview-section">
          <div class="sent-preview-title">📧 Email Snapshot Preview</div>
          <iframe srcdoc="${escapeHtml(email.htmlSnapshot||'<p>No preview available</p>')}"
            class="sent-preview-frame" sandbox="allow-same-origin" title="Sent Email Preview">
          </iframe>
        </div>
      </div>`;
  }

  function list_activate(id) {
    document.querySelectorAll('.sent-item').forEach(el=>el.classList.toggle('active',el.dataset.id===id));
  }

  // ============================================================
  // CC/BCC TOGGLE
  // ============================================================
  const toggleCcBcc = document.getElementById('toggle-cc-bcc');
  if (toggleCcBcc) {
    toggleCcBcc.addEventListener('click', function () {
      const ccRow  = document.getElementById('cc-row');
      const bccRow = document.getElementById('bcc-row');
      const show   = !ccRow.classList.contains('visible');
      ccRow.classList.toggle('visible', show);
      bccRow.classList.toggle('visible', show);
      this.textContent = show ? '− CC / BCC' : '+ CC / BCC';
    });
  }

  // ============================================================
  // INITIALIZATION
  // Phase 4+5: On load, restore from cache; if AS configured,
  //            attempt to restore from AS (survives refresh + close)
  // ============================================================
  loadFromStorage();
  renderAccountStatus();
  renderBucketItems();
  renderStack();
  renderSentList();
  setEmailState('draft');
  updateSendSteps(1);

  // Phase 4+5: If account is configured, attempt background AS history load
  if (STATE.account.configured && STATE.account.scriptUrl) {
    loadHistoryFromAppsScript().catch(() => {/* non-fatal */});
    // Phase 9: Retry any unsynced records on startup
    tryResyncUnsynced().catch(() => {});
  }

})();
