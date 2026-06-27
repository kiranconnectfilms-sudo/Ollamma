'use strict';

// Local model via Ollama — runs entirely on this machine, no API key,
// no per-request billing. Requires `ollama serve` running locally and
// the model already pulled (e.g. `ollama pull gemma3:4b`).
const MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const API_URL = `${BASE_URL}/api/chat`;

class OllamaConfigError extends Error {}
class OllamaApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Send a single-turn message to the local Ollama model and return the
 * text of the reply. Mirrors the old askClaude({system, user, ...}) shape
 * so the rest of the app (aiEdit.js) doesn't need to change.
 * @param {Object} opts
 * @param {string} opts.system - system prompt
 * @param {string} opts.user - user message content
 * @param {number} [opts.maxTokens=8000] - mapped to num_predict
 * @param {number} [opts.temperature=0.4]
 */
async function askLocalModel({ system, user, maxTokens = 8000, temperature = 0.4 }) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
    });
  } catch (err) {
    throw new OllamaConfigError(
      `Could not reach Ollama at ${BASE_URL}. Is it running? Start it with "ollama serve" ` +
      `(or just open the Ollama app), then make sure the model is pulled: "ollama pull ${MODEL}".`
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.error || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    // Ollama returns 404 with an error message when the model isn't pulled yet.
    if (res.status === 404) {
      throw new OllamaConfigError(
        `Model "${MODEL}" isn't available in Ollama yet. Run: ollama pull ${MODEL}`
      );
    }
    throw new OllamaApiError(`Ollama request failed (${res.status})`, res.status, detail);
  }

  const data = await res.json();
  // Non-streaming /api/chat returns { message: { role, content }, ... }
  const text = data?.message?.content || '';
  if (!text) {
    throw new OllamaApiError('Ollama returned an empty response', res.status, data);
  }
  return text;
}

/**
 * Ask the local model for strict JSON output. Strips markdown code fences
 * defensively and throws a descriptive error if parsing fails.
 * Smaller local models are more prone to wrapping JSON in prose or fences
 * than Claude was, so this is a bit more lenient about extracting the
 * JSON object from surrounding text.
 */
async function askLocalModelForJson(opts) {
  const raw = await askLocalModel(opts);
  let cleaned = raw.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back: grab the first {...} or [...] block in case the model
    // added stray commentary before/after the JSON.
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to the error below
      }
    }
    throw new Error(
      `Local model did not return valid JSON. First 300 chars: ${cleaned.slice(0, 300)}`
    );
  }
}

module.exports = {
  askLocalModel,
  askLocalModelForJson,
  OllamaConfigError,
  OllamaApiError,
  MODEL,
};
