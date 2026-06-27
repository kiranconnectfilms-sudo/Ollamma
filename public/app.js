'use strict';

(() => {
  const SUPPORTED_EXT = ['docx', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'doc', 'pdf', 'txt'];
  const MAX_MB = 25;

  const screens = {
    gate: document.getElementById('screen-gate'),
    upload: document.getElementById('screen-upload'),
    processing: document.getElementById('screen-processing'),
    done: document.getElementById('screen-done'),
    error: document.getElementById('screen-error'),
  };

  // --- Gate elements ---
  const gateTabs = document.querySelectorAll('.gate-tab');
  const panelRedeem = document.getElementById('gate-panel-redeem');
  const panelRequest = document.getElementById('gate-panel-request');
  const codeInput = document.getElementById('codeInput');
  const redeemBtn = document.getElementById('redeemBtn');
  const redeemError = document.getElementById('redeemError');
  const emailInput = document.getElementById('emailInput');
  const reasonInput = document.getElementById('reasonInput');
  const requestBtn = document.getElementById('requestBtn');
  const requestMessage = document.getElementById('requestMessage');

  // --- Upload-screen elements ---
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileChip = document.getElementById('fileChip');
  const fileChipIcon = document.getElementById('fileChipIcon');
  const fileChipName = document.getElementById('fileChipName');
  const fileChipSize = document.getElementById('fileChipSize');
  const fileChipRemove = document.getElementById('fileChipRemove');
  const instructionBox = document.getElementById('instructionBox');
  const instructionInput = document.getElementById('instructionInput');
  const processBtn = document.getElementById('processBtn');
  const aiWarning = document.getElementById('aiWarning');

  const processingSteps = document.getElementById('processingSteps');
  const processingTitle = document.getElementById('processingTitle');

  const doneSummary = document.getElementById('doneSummary');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadLabel = document.getElementById('downloadLabel');
  const startOverBtn = document.getElementById('startOverBtn');

  const errorMessage = document.getElementById('errorMessage');
  const errorRetryBtn = document.getElementById('errorRetryBtn');

  let selectedFile = null;
  // The access code accepted by the gate screen. Held only in memory —
  // refreshing the page clears it, and the server treats every code as
  // single-use anyway. Not put in localStorage on purpose: a stale code
  // would just frustrate the user with "already used" errors next time.
  let accessCode = null;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle('screen-active', key === name);
    });
  }

  // --- Gate: tab switching ---
  gateTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      gateTabs.forEach((t) => t.classList.remove('gate-tab-active'));
      tab.classList.add('gate-tab-active');
      const which = tab.dataset.tab;
      panelRedeem.classList.toggle('hidden', which !== 'redeem');
      panelRequest.classList.toggle('hidden', which !== 'request');
      redeemError.classList.add('hidden');
      requestMessage.classList.add('hidden');
    });
  });

  // --- Gate: request access ---
  requestBtn.addEventListener('click', async () => {
    const email = (emailInput.value || '').trim();
    const reason = (reasonInput.value || '').trim();
    if (!email) {
      requestMessage.textContent = 'Please enter your email.';
      requestMessage.classList.remove('hidden');
      return;
    }

    requestBtn.disabled = true;
    requestMessage.classList.add('hidden');
    try {
      const res = await fetch('/api/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason }),
      });
      const data = await res.json();
      requestMessage.textContent = res.ok
        ? (data.message || 'Request submitted. Check your email shortly.')
        : (data.error || 'Could not submit your request.');
      requestMessage.classList.remove('hidden');
      if (res.ok) {
        emailInput.value = '';
        reasonInput.value = '';
      }
    } catch {
      requestMessage.textContent = 'Could not reach the server. Try again in a moment.';
      requestMessage.classList.remove('hidden');
    } finally {
      requestBtn.disabled = false;
    }
  });

  // --- Gate: redeem code ---
  // We don't actually consume the code here — that happens server-side when
  // the user uploads a file. This step just validates the code shape so we
  // can move them to the upload screen without a round-trip pinch point.
  redeemBtn.addEventListener('click', () => {
    const raw = (codeInput.value || '').trim().toUpperCase();
    if (!raw) {
      redeemError.textContent = 'Please enter your access code.';
      redeemError.classList.remove('hidden');
      return;
    }
    accessCode = raw;
    redeemError.classList.add('hidden');
    showScreen('upload');
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      redeemBtn.click();
    }
  });

  function extOf(filename) {
    return (filename.split('.').pop() || '').toLowerCase();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setSelectedFile(file) {
    const ext = extOf(file.name);

    if (!SUPPORTED_EXT.includes(ext)) {
      showError(`".${ext}" isn't supported. Upload a Word, Excel, PowerPoint, PDF, or text file.`);
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      showError(`That file is larger than the ${MAX_MB}MB limit.`);
      return;
    }

    selectedFile = file;
    fileChipIcon.textContent = ext.slice(0, 3).toUpperCase();
    fileChipName.textContent = file.name;
    fileChipSize.textContent = formatSize(file.size);
    fileChip.classList.remove('hidden');
    instructionBox.classList.remove('hidden');
    processBtn.classList.remove('hidden');
    processBtn.disabled = false;
    dropzone.style.display = 'none';
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    fileChip.classList.add('hidden');
    instructionBox.classList.add('hidden');
    processBtn.classList.add('hidden');
    processBtn.disabled = true;
    instructionInput.value = '';
    dropzone.style.display = '';
  }

  // --- Drag & drop wiring ---
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) setSelectedFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) setSelectedFile(file);
  });

  fileChipRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelectedFile();
  });

  // --- Processing UI ---
  function setStep(stepName) {
    const items = processingSteps.querySelectorAll('li');
    let reached = false;
    items.forEach((li) => {
      const isTarget = li.dataset.step === stepName;
      if (isTarget) reached = true;
      li.classList.toggle('active', isTarget);
      li.classList.toggle('complete', !isTarget && !reached);
    });
  }

  async function processFile() {
    showScreen('processing');
    setStep('parse');
    processingTitle.textContent = 'Reading your file…';

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('instruction', instructionInput.value || '');
    if (accessCode) formData.append('accessCode', accessCode);

    // Visual progression — the real work happens server-side in one request,
    // so we advance these as time-based hints rather than true progress events.
    const t1 = setTimeout(() => {
      setStep('ai');
      processingTitle.textContent = 'AI is editing the content…';
    }, 900);
    const t2 = setTimeout(() => {
      setStep('build');
      processingTitle.textContent = 'Rebuilding your file…';
    }, 3200);

    try {
      const res = await fetch('/api/edit', { method: 'POST', body: formData });
      const data = await res.json();
      clearTimeout(t1);
      clearTimeout(t2);

      if (res.status === 401) {
        // Code rejected — boot back to the gate so they can enter a new one.
        accessCode = null;
        showError(data.error || 'Your access code is no longer valid.');
        return;
      }

      if (!res.ok) {
        showError(data.error || 'Something went wrong while processing this file.');
        return;
      }

      // Successful edit consumed the code; clear it so the next upload prompts
      // for a new one rather than silently failing on the server.
      accessCode = null;

      setStep('build');
      downloadBtn.href = `/api/download/${data.jobId}`;
      downloadLabel.textContent = `Download ${data.filename}`;
      doneSummary.textContent = summaryFor(data);
      showScreen('done');
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      showError('Could not reach the server. Check your connection and try again.');
    }
  }

  function summaryFor(data) {
    if (data.kind === 'document') return `${data.blockCount} sections reviewed and polished.`;
    if (data.kind === 'spreadsheet') return `${data.sheetCount} sheet(s) cleaned and reformatted.`;
    if (data.kind === 'csv') return `${data.rowCount} rows reviewed.`;
    if (data.kind === 'presentation') return `${data.slideCount} slides refined.`;
    if (data.kind === 'pdf') return `${data.blockCount} sections reviewed and polished.`;
    if (data.kind === 'text') return `${data.blockCount} paragraphs reviewed.`;
    return 'Your file has been updated.';
  }

  function showError(message) {
    errorMessage.textContent = message;
    showScreen('error');
  }

  processBtn.addEventListener('click', processFile);
  errorRetryBtn.addEventListener('click', () => {
    // If we still have a valid code in memory, go back to upload; otherwise
    // the user needs a new code, so send them to the gate.
    showScreen(accessCode ? 'upload' : 'gate');
  });
  startOverBtn.addEventListener('click', () => {
    clearSelectedFile();
    // The previous code was already consumed by the just-finished edit, so
    // editing another file requires requesting/redeeming a fresh code.
    showScreen('gate');
    codeInput.value = '';
    codeInput.focus();
  });

  // --- AI configuration check ---
  fetch('/api/health')
    .then((r) => r.json())
    .then((data) => {
      if (!data.aiConfigured) {
        aiWarning.classList.remove('hidden');
        processBtn.disabled = true;
      }
    })
    .catch(() => {});
})();
