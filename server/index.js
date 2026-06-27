'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const editRoute = require('./routes/edit');

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return { reachable: false, modelPulled: false };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const modelPulled = models.some((m) => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL}:`) || `${m}` === OLLAMA_MODEL);
    return { reachable: true, modelPulled };
  } catch {
    return { reachable: false, modelPulled: false };
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (req, res) => {
  const { reachable, modelPulled } = await checkOllama();
  res.json({
    ok: true,
    aiConfigured: reachable && modelPulled,
    ollamaReachable: reachable,
    modelPulled,
    model: OLLAMA_MODEL,
  });
});

app.use('/api', editRoute);

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File is too large. Max size is ${process.env.MAX_UPLOAD_MB || 25}MB.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, async () => {
  console.log(`\n  AI Document Editor running at http://localhost:${PORT}`);
  const { reachable, modelPulled } = await checkOllama();
  if (!reachable) {
    console.log(`\n  WARNING: Can't reach Ollama at ${OLLAMA_BASE_URL}.`);
    console.log('  Start it with "ollama serve" (or open the Ollama app), then restart this server.\n');
  } else if (!modelPulled) {
    console.log(`\n  WARNING: Model "${OLLAMA_MODEL}" isn't pulled yet.`);
    console.log(`  Run: ollama pull ${OLLAMA_MODEL}\n`);
  } else {
    console.log(`  AI features ready — using local model "${OLLAMA_MODEL}" via Ollama, no API key needed.\n`);
  }
});
