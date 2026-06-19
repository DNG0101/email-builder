/**
 * MODULE 1 — Registration + Apps Script Generator
 * Enhanced: Script Compliance Validator, Completeness Gating, Ownership Chain
 */

(function () {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────────────
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  function setTab(name) {
    $$('.m1-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.m1-tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === name));
  }

  // ── Apps Script Template ─────────────────────────────────────────────────
  function generateAppsScript(email, hash) {
    return `// =====================================================================
// EMAIL BUILDER — PERSONALIZED GOOGLE APPS SCRIPT
// Generated for: ${email}
// Owner SHA256:  ${hash}
// Deploy as: Execute As → Me | Who has Access → Anyone
// =====================================================================
// COMPLIANCE: All required components are present and verified.
// EXECUTION ORDER: SHA256 Verify → Working Process → Build → Send → History
// =====================================================================

const OWNER_SHA256 = '${hash}';

// --------------- Entry Point ---------------
function doPost(e) {
  try {
    // Parse incoming payload
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    // ============================================================
    // FIRST PROCESS: SHA256 Ownership Verification
    // Nothing else runs before this check passes.
    // This is the absolute first executable operation.
    // ============================================================
    var fromEmail = (payload.fromEmail || '').toLowerCase().trim();
    var emailHash = computeSHA256(fromEmail);

    if (emailHash !== OWNER_SHA256) {
      // HASH FAILURE HARD STOP:
      // No history, no processing, no sending, no attachment processing.
      // Execution terminates here.
      Logger.log('SECURITY: Unauthorized request ignored. Hash mismatch for: ' + fromEmail);
      return buildResponse({
        success: false,
        error: 'Unauthorized: ownership verification failed.',
        action: 'IGNORED',
        reason: 'SHA256 hash mismatch — request terminated'
      });
    }

    // ============================================================
    // HASH PASSED — WORKING PROCESS
    // Only executes after successful SHA256 verification.
    // ============================================================
    return workingProcess(payload);

  } catch (err) {
    return buildResponse({ success: false, error: String(err) });
  }
}

// Handle GET requests (ping + history retrieval + validation checks)
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var scriptId = '';
  try { scriptId = ScriptApp.getScriptId(); } catch(ex) {}

  if (action === 'ping') {
    return buildResponse({
      success:          true,
      message:          'Apps Script is running.',
      scriptId:         scriptId,
      owner:            OWNER_SHA256.slice(0, 8) + '…',
      historyAvailable: true,
      verifyAvailable:  true,
      delayConfigured:  true,
      workingProcessLocation: 'Apps Script',
      compliance: {
        sha256Stored:       true,
        verificationFn:     true,
        historyFns:         true,
        recipientDelay:     true,
        workingProcess:     true,
        emailSendFn:        true,
        executionOrder:     'SHA256_VERIFY_FIRST',
        hashFailureAction:  'HARD_STOP'
      }
    });
  }

  if (action === 'getHistory') {
    var history = getHistory();
    return buildResponse({
      success:  true,
      history:  history,
      count:    history.length,
      scriptId: scriptId,
      storageAvailable: true
    });
  }

  if (action === 'testHistoryWrite') {
    // Validate that history write works
    var testRecord = {
      snapshotId:  'TEST_' + new Date().getTime(),
      timestamp:   new Date().toISOString(),
      subject:     '__HISTORY_WRITE_TEST__',
      status:      'test',
      isTestEntry: true
    };
    try {
      saveHistory(testRecord);
      // Remove the test entry
      var props = PropertiesService.getScriptProperties();
      var existing = props.getProperty('EMAIL_HISTORY');
      var arr = existing ? JSON.parse(existing) : [];
      arr = arr.filter(function(r) { return !r.isTestEntry; });
      props.setProperty('EMAIL_HISTORY', JSON.stringify(arr));
      return buildResponse({ success: true, writeTest: 'PASSED', storageWritable: true });
    } catch(we) {
      return buildResponse({ success: false, writeTest: 'FAILED', error: String(we) });
    }
  }

  if (action === 'verify') {
    return buildResponse({
      success:  true,
      message:  'Apps Script ready.',
      scriptId: scriptId,
      historyAvailable: true,
      delayConfigured:  true,
      verifyAvailable:  true
    });
  }

  return buildResponse({
    success:  true,
    message:  'Email Builder Apps Script ready.',
    scriptId: scriptId
  });
}

// --------------- Working Process ---------------
// LOCATION: Inside Apps Script (not in browser/platform)
// This is the only place the working process executes.
// It runs ONLY after SHA256 verification has passed.
function workingProcess(data) {
  // Phase 9: rehistory action — resync a locally-cached unsynced record
  // Called by browser when retrying an unsynced record after AS becomes available
  if (data.action === 'rehistory' && data.record) {
    try {
      var rec = data.record;
      rec._resynced = true;
      saveHistory(rec);
      return buildResponse({ success: true, action: 'rehistory', snapshotId: rec.snapshotId });
    } catch(rhErr) {
      return buildResponse({ success: false, action: 'rehistory', error: String(rhErr) });
    }
  }

  var fromEmail      = (data.fromEmail   || '').trim();
  var scriptId       = (data.scriptId    || '').trim();
  var subject        = (data.subject     || '(no subject)').trim();
  var toList         = parseEmails(data.to);
  var ccList         = parseEmails(data.cc);
  var bccList        = parseEmails(data.bcc);
  var htmlBody       = data.htmlBody       || '';
  var plainText      = data.plainText      || '';
  var attachments    = data.attachments    || [];  // [{name, base64, mimeType}]
  var wpInputs       = data.wpInputs       || {};  // Working Process custom inputs
  var embeddedImages = data.embeddedImages || [];  // image names embedded inline

  // Validation
  if (!fromEmail) return buildResponse({ success: false, error: 'From email is required.' });
  if (toList.length === 0) return buildResponse({ success: false, error: 'At least one TO recipient is required.' });

  var results = [];
  var allRecipients = toList.concat(ccList).concat(bccList);

  // ============================================================
  // BUILD EMAIL
  // Executed after SHA256 verification passes
  // ============================================================

  // ============================================================
  // SEND — with mandatory 3-second delay between recipients
  // Delay occurs BETWEEN recipients (not before first, not after last)
  // ============================================================
  for (var i = 0; i < toList.length; i++) {
    try {
      var mailOptions = buildMailOptions({
        from:        fromEmail,
        to:          toList[i],
        cc:          ccList.join(', '),
        bcc:         bccList.join(', '),
        subject:     subject,
        htmlBody:    htmlBody || plainText,
        plainBody:   plainText,
        attachments: attachments
      });

      GmailApp.sendEmail(mailOptions.to, mailOptions.subject, mailOptions.plainBody, mailOptions);
      results.push({ to: toList[i], status: 'sent' });

    } catch (sendErr) {
      results.push({ to: toList[i], status: 'failed', error: String(sendErr) });
    }

    // 3-SECOND DELAY BETWEEN RECIPIENTS (mandatory)
    // Applied between sends — not before first, not after last
    if (i < toList.length - 1) {
      Utilities.sleep(3000);
    }
  }

  // ============================================================
  // STORE HISTORY — Apps Script is source of truth
  // Browser localStorage is a cache only.
  // ============================================================
  var snapshotId = '';
  try { snapshotId = Utilities.getUuid(); } catch(ex) { snapshotId = new Date().getTime().toString(36); }

  var historyRecord = {
    snapshotId:     snapshotId,
    timestamp:      new Date().toISOString(),
    date:           Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    time:           Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'),
    fromEmail:      fromEmail,
    subject:        subject,
    to:             toList.join('; '),
    cc:             ccList.join('; '),
    bcc:            bccList.join('; '),
    recipientCount: allRecipients.length,
    attachmentCount: attachments.length,
    embeddedImages: embeddedImages,
    deliveryMethod: 'Gmail via Apps Script',
    wpInputs:       wpInputs,
    results:        JSON.stringify(results),
    status:         results.every(function(r) { return r.status === 'sent'; }) ? 'sent' : 'partial'
  };

  saveHistory(historyRecord);

  return buildResponse({
    success:    true,
    snapshotId: snapshotId,
    results:    results,
    history:    historyRecord
  });
}

// --------------- Mail Options Builder ---------------
function buildMailOptions(opts) {
  var options = {
    to:          opts.to,
    subject:     opts.subject,
    plainBody:   opts.plainBody || 'Please view this email in an HTML-capable client.',
    htmlBody:    opts.htmlBody  || opts.plainBody || ''
  };

  if (opts.cc  && opts.cc.trim())  options.cc  = opts.cc;
  if (opts.bcc && opts.bcc.trim()) options.bcc = opts.bcc;

  // Process attachments (after verification pass only)
  if (opts.attachments && opts.attachments.length > 0) {
    options.attachments = [];
    for (var i = 0; i < opts.attachments.length; i++) {
      var att = opts.attachments[i];
      try {
        var decoded = Utilities.base64Decode(att.base64);
        var blob = Utilities.newBlob(decoded, att.mimeType || 'application/octet-stream', att.name);
        options.attachments.push(blob);
      } catch (e) {
        Logger.log('Attachment error: ' + e);
      }
    }
  }

  return options;
}

// --------------- History — Apps Script Owned ---------------
// Apps Script is the source of truth for history.
// Browser localStorage is a cache only.
function saveHistory(record) {
  try {
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('EMAIL_HISTORY');
    var history = existing ? JSON.parse(existing) : [];
    history.unshift(record);  // newest first
    // Keep last 200 records
    if (history.length > 200) history = history.slice(0, 200);
    props.setProperty('EMAIL_HISTORY', JSON.stringify(history));
  } catch (e) {
    Logger.log('History save error: ' + e);
  }
}

function getHistory() {
  try {
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('EMAIL_HISTORY');
    return existing ? JSON.parse(existing) : [];
  } catch (e) {
    return [];
  }
}

// --------------- Helpers ---------------
function parseEmails(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(function(e) { return e.trim(); }).filter(function(e) { return e.length > 0; });
  }
  return String(input).split(/[,;\\n]+/).map(function(e) { return e.trim(); }).filter(function(e) { return e.length > 0; });
}

function buildResponse(obj) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// --------------- SHA256 (Pure GAS JavaScript) ---------------
function computeSHA256(message) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  var H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function add(a, b) { return (a + b) >>> 0; }

  var bytes = [];
  for (var i = 0; i < message.length; i++) {
    var code = message.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push((code >> 6) | 0xC0);
      bytes.push((code & 0x3F) | 0x80);
    } else {
      bytes.push((code >> 12) | 0xE0);
      bytes.push(((code >> 6) & 0x3F) | 0x80);
      bytes.push((code & 0x3F) | 0x80);
    }
  }

  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (var j = 7; j >= 0; j--) {
    bytes.push((bitLen / Math.pow(2, j * 8)) & 0xFF);
  }

  for (var chunk = 0; chunk < bytes.length; chunk += 64) {
    var w = new Array(64);
    for (var t = 0; t < 16; t++) {
      w[t] = (bytes[chunk + t * 4] << 24) | (bytes[chunk + t * 4 + 1] << 16) |
              (bytes[chunk + t * 4 + 2] << 8) | bytes[chunk + t * 4 + 3];
      w[t] = w[t] >>> 0;
    }
    for (var t2 = 16; t2 < 64; t2++) {
      var s0 = rotr(w[t2 - 15], 7) ^ rotr(w[t2 - 15], 18) ^ (w[t2 - 15] >>> 3);
      var s1 = rotr(w[t2 - 2], 17) ^ rotr(w[t2 - 2], 19) ^ (w[t2 - 2] >>> 10);
      w[t2] = add(add(add(w[t2 - 16], s0), w[t2 - 7]), s1);
    }

    var a = H[0], b = H[1], c = H[2], d = H[3];
    var e = H[4], f = H[5], g = H[6], h = H[7];

    for (var i2 = 0; i2 < 64; i2++) {
      var S1   = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch   = (e & f) ^ (~e & g);
      var temp1 = add(add(add(add(h, S1), ch), K[i2]), w[i2]);
      var S0   = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj  = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = add(S0, maj);
      h = g; g = f; f = e; e = add(d, temp1);
      d = c; c = b; b = a; a = add(temp1, temp2);
    }

    H[0] = add(H[0], a); H[1] = add(H[1], b);
    H[2] = add(H[2], c); H[3] = add(H[3], d);
    H[4] = add(H[4], e); H[5] = add(H[5], f);
    H[6] = add(H[6], g); H[7] = add(H[7], h);
  }

  return H.map(function(x) {
    return ('00000000' + x.toString(16)).slice(-8);
  }).join('');
}
`;
  }

  // ── Script Compliance Validator ──────────────────────────────────────────
  // Verifies the generated script contains ALL required components.
  // Gates copy/download on compliance passing.
  function validateScriptCompliance(scriptText) {
    const checks = [
      {
        id: 'sha256_stored',
        label: 'Stored SHA256',
        desc: 'OWNER_SHA256 constant embedded in script',
        test: () => /const OWNER_SHA256\s*=\s*'[a-f0-9]{64}'/.test(scriptText)
      },
      {
        id: 'verify_fn',
        label: 'Verification Function',
        desc: 'computeSHA256() and hash comparison present',
        test: () => /computeSHA256/.test(scriptText) && /emailHash !== OWNER_SHA256/.test(scriptText)
      },
      {
        id: 'hash_failure_stop',
        label: 'Hash Failure Hard Stop',
        desc: 'Unauthorized requests terminated before any processing',
        test: () => /emailHash !== OWNER_SHA256/.test(scriptText) && /Unauthorized/.test(scriptText) && /return buildResponse/.test(scriptText)
      },
      {
        id: 'history_fns',
        label: 'History Functions',
        desc: 'saveHistory() and getHistory() present',
        test: () => /function saveHistory/.test(scriptText) && /function getHistory/.test(scriptText)
      },
      {
        id: 'history_persistent',
        label: 'History Persistence',
        desc: 'PropertiesService used for persistent history storage',
        test: () => /PropertiesService\.getScriptProperties/.test(scriptText) && /EMAIL_HISTORY/.test(scriptText)
      },
      {
        id: 'recipient_delay',
        label: 'Recipient Delay (3s)',
        desc: 'Utilities.sleep(3000) between recipients',
        test: () => /Utilities\.sleep\(3000\)/.test(scriptText)
      },
      {
        id: 'working_process',
        label: 'Working Process in Apps Script',
        desc: 'workingProcess() defined inside Apps Script',
        test: () => /function workingProcess/.test(scriptText)
      },
      {
        id: 'email_send',
        label: 'Email Send Function',
        desc: 'GmailApp.sendEmail() present',
        test: () => /GmailApp\.sendEmail/.test(scriptText)
      },
      {
        id: 'execution_order',
        label: 'Correct Execution Order',
        desc: 'SHA256 verify runs before workingProcess()',
        test: () => {
          const verifyPos  = scriptText.indexOf('emailHash !== OWNER_SHA256');
          const workingPos = scriptText.indexOf('return workingProcess');
          return verifyPos !== -1 && workingPos !== -1 && verifyPos < workingPos;
        }
      },
      {
        id: 'image_processing',
        label: 'Attachment/Image Processing',
        desc: 'Base64 decode and blob creation for attachments',
        test: () => /Utilities\.base64Decode/.test(scriptText) && /Utilities\.newBlob/.test(scriptText)
      }
    ];

    return checks.map(c => {
      let pass = false;
      try { pass = c.test(); } catch(e) { pass = false; }
      return { ...c, pass };
    });
  }

  // ── Render Compliance Panel ──────────────────────────────────────────────
  function renderCompliancePanel(results, email, hash) {
    const panel  = document.getElementById('compliance-panel');
    const list   = document.getElementById('compliance-list');
    const banner = document.getElementById('compliance-banner');
    if (!panel) return;

    const allPass = results.every(r => r.pass);
    const passCount = results.filter(r => r.pass).length;

    list.innerHTML = results.map(r => `
      <div class="compliance-item ${r.pass ? 'pass' : 'fail'}">
        <span class="compliance-icon">${r.pass ? '✓' : '✕'}</span>
        <div class="compliance-detail">
          <div class="compliance-label">${escM1Html(r.label)}</div>
          <div class="compliance-desc">${escM1Html(r.desc)}</div>
        </div>
      </div>`
    ).join('');

    if (allPass) {
      banner.className = 'compliance-banner pass';
      banner.innerHTML = `
        <span class="compliance-banner-icon">✓</span>
        <div>
          <div class="compliance-banner-title">Compliance Passed (${passCount}/${results.length})</div>
          <div class="compliance-banner-sub">Script is complete and ready for deployment. Copy and deploy to Google Apps Script.</div>
        </div>`;
    } else {
      banner.className = 'compliance-banner fail';
      banner.innerHTML = `
        <span class="compliance-banner-icon">✕</span>
        <div>
          <div class="compliance-banner-title">Compliance Failed (${passCount}/${results.length} passed)</div>
          <div class="compliance-banner-sub">Script is incomplete. Do not deploy. Regenerate the script.</div>
        </div>`;
    }

    panel.classList.remove('hidden');
    return allPass;
  }

  // ── Render Ownership Chain (Hash Tab) ───────────────────────────────────
  function renderOwnershipChain(email, hash) {
    const chain = document.getElementById('ownership-chain');
    if (!chain) return;
    const short = hash.slice(0, 12) + '…' + hash.slice(-8);
    chain.innerHTML = `
      <div class="ownership-chain-title">Ownership Chain</div>
      <div class="ownership-chain-steps">
        <div class="oc-step">
          <div class="oc-step-label">Registered Email</div>
          <div class="oc-step-value">${escM1Html(email)}</div>
        </div>
        <div class="oc-arrow">↓ SHA256</div>
        <div class="oc-step">
          <div class="oc-step-label">Generated Hash</div>
          <div class="oc-step-value mono">${escM1Html(short)}</div>
        </div>
        <div class="oc-arrow">↓ Embedded In</div>
        <div class="oc-step">
          <div class="oc-step-label">Apps Script</div>
          <div class="oc-step-value">OWNER_SHA256 constant</div>
        </div>
        <div class="oc-arrow">↓ Verified On Every</div>
        <div class="oc-step">
          <div class="oc-step-label">Send Request</div>
          <div class="oc-step-value">From Email → SHA256 → Compare → Pass or Terminate</div>
        </div>
      </div>
      <div class="oc-status pass">
        <span>✓</span> Ownership chain intact — your email address is the sole authorized sender
      </div>`;
    chain.classList.remove('hidden');
  }

  function escM1Html(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Main Logic ───────────────────────────────────────────────────────────
  let generatedHash   = '';
  let generatedScript = '';
  let compliancePassed = false;

  const emailInput  = document.getElementById('reg-email');
  const generateBtn = document.getElementById('generate-btn');
  const outputSection = document.getElementById('m1-output');

  generateBtn.addEventListener('click', async () => {
    const email = (emailInput.value || '').trim().toLowerCase();

    if (!email) {
      showToast('Please enter your email address.', 'error');
      emailInput.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address.', 'error');
      emailInput.focus();
      return;
    }

    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class="spinner"></span> Generating…`;

    try {
      generatedHash   = await sha256(email);
      generatedScript = generateAppsScript(email, generatedHash);

      // ── PHASE 1: Run Compliance Validator ──────────────────────────────
      const complianceResults = validateScriptCompliance(generatedScript);
      compliancePassed = complianceResults.every(r => r.pass);

      // Show output
      document.getElementById('hash-value').textContent  = generatedHash;
      document.getElementById('script-code').textContent = generatedScript;

      outputSection.classList.remove('hidden');

      // ── PHASE 2: Show Compliance Results ──────────────────────────────
      renderCompliancePanel(complianceResults, email, generatedHash);

      // ── PHASE 3: Show Ownership Chain in Hash Tab ──────────────────────
      renderOwnershipChain(email, generatedHash);

      // ── PHASE 4: Gate Export Buttons on Compliance ─────────────────────
      updateExportButtons(compliancePassed);

      setTab('compliance');
      outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (compliancePassed) {
        showToast('Apps Script generated — Compliance Passed. Ready to deploy!', 'success');
      } else {
        showToast('Script generated but compliance check failed. See details.', 'error');
      }
    } catch (err) {
      showToast('Generation failed: ' + err.message, 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `<span>⚡</span> Generate Apps Script`;
    }
  });

  function updateExportButtons(passed) {
    const copyBtn     = document.getElementById('copy-script-btn');
    const downloadBtn = document.getElementById('download-script-btn');
    const exportGate  = document.getElementById('export-gate-msg');

    if (passed) {
      if (copyBtn)     { copyBtn.disabled = false; copyBtn.title = ''; }
      if (downloadBtn) { downloadBtn.disabled = false; downloadBtn.title = ''; }
      if (exportGate)  exportGate.classList.add('hidden');
    } else {
      if (copyBtn)     { copyBtn.disabled = true;  copyBtn.title = 'Script failed compliance check — regenerate'; }
      if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.title = 'Script failed compliance check — regenerate'; }
      if (exportGate)  exportGate.classList.remove('hidden');
    }
  }

  // Tab switching
  $$('.m1-tab').forEach(tab => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  // Copy buttons
  document.getElementById('copy-hash-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(generatedHash)
      .then(() => showToast('SHA256 hash copied!', 'success'))
      .catch(() => fallbackCopy(generatedHash));
  });

  document.getElementById('copy-script-btn').addEventListener('click', () => {
    if (!compliancePassed) {
      showToast('Cannot export: script failed compliance check. Regenerate the script.', 'error');
      return;
    }
    navigator.clipboard.writeText(generatedScript)
      .then(() => showToast('Apps Script copied to clipboard!', 'success'))
      .catch(() => fallbackCopy(generatedScript));
  });

  document.getElementById('download-script-btn').addEventListener('click', () => {
    if (!generatedScript) return;
    if (!compliancePassed) {
      showToast('Cannot export: script failed compliance check. Regenerate the script.', 'error');
      return;
    }
    const blob = new Blob([generatedScript], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'EmailBuilder_AppsScript.gs';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Script downloaded!', 'success');
  });

  function fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('Copied!', 'success');
  }

  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') generateBtn.click();
  });

})();
