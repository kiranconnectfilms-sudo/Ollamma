# Docket — AI edits your file, same format back

Upload a Word, Excel, PowerPoint, PDF, or text file. A local AI model polishes
the content — wording, grammar, structure, formatting — and you download it
back in the **same file format** you uploaded. No login, no signup, no stored
accounts, no API key, and no per-request billing — the model runs entirely on
your own machine via [Ollama](https://ollama.com). Files are processed in
memory and discarded after a single download.

## What this does (and doesn't) do

- **Does:** real parsing and real file generation for `.docx`, `.xlsx`/`.csv`,
  `.pptx`, `.pdf`, and `.txt`, with a local model (via Ollama) doing the
  editing in between — free and offline, no Anthropic API key required.
- **Does not:** convert between formats (Excel in → Excel out, not PowerPoint).
  That's by design — see the brief this was built against.
- **Does not** read legacy binary `.doc` / `.xls` / `.ppt` (pre-2007 Office
  formats). Those need to be re-saved as `.docx` / `.xlsx` / `.pptx` first —
  the app tells the user this clearly if they try.

## What's been verified

Tested directly in development (the AI call's request/response plumbing was
verified against the contract Ollama's `/api/chat` endpoint exposes; actual
editing quality depends on which local model is pulled — see "Not yet
tested" below):

- **Round-trip build → parse** for DOCX, XLSX, PPTX, PDF, TXT, CSV — each
  format was built from sample content and parsed back, confirming the
  generated files are valid and content survives the round trip.
- **Generated file validity** — DOCX confirmed as a well-formed OOXML zip;
  PDF confirmed readable by `pdftotext`/`pdfinfo` (Poppler), an independent
  PDF engine, not just our own parser.
- **Full Express upload route** (`/api/edit`) exercised with real multipart
  uploads for every format — each correctly parses and fails clearly at the
  AI-call step when Ollama isn't running or the model isn't pulled, proving
  the parse stage works end-to-end through the actual HTTP route, not just
  in isolation.
- **Error paths**: missing file, unsupported extension, legacy `.doc`/`.xls`/
  `.ppt` rejection, expired/unknown download job, Ollama unreachable, model
  not pulled, and a malformed/empty model response — all return clean JSON
  errors instead of crashing.
- **`askLocalModelForJson`** confirmed to correctly strip markdown code
  fences, and falls back to extracting the first `{...}`/`[...]` block if the
  model adds stray commentary around the JSON — smaller local models do this
  more often than larger hosted ones.

Two real bugs were found and fixed during this testing:
- The original PPTX parser looked for `<p:ph type="title">` placeholder
  shapes, which `pptxgenjs`-generated slides don't have — titles were
  silently misread as body bullets. Fixed by switching to a shape-order
  heuristic (first text-bearing shape = title).
- The original PDF parser (`pdf-parse`) bundles a years-old pdf.js that
  cannot read modern compressed cross-reference streams — including PDFs
  produced by this app's own `pdf-lib`-based builder. Replaced with the
  actively-maintained `pdfjs-dist` package.

**Not yet tested**: actual AI output quality against the local model end to
end on real documents — only the request/response plumbing and error
handling were verified, not whether the edits are well-judged for any given
real document. Quality will vary a lot by which model you pull; small models
(e.g. `gemma3:4b`) are fast but less reliable at following the "preserve every
fact, return the exact same JSON shape" instructions than larger ones.

## Setup

```bash
# 1. Install Ollama if you haven't already: https://ollama.com/download

# 2. Make sure Ollama is running
ollama serve            # or just open the Ollama desktop app

# 3. Pull the model once (only needed the first time)
ollama pull gemma3:4b

# 4. Install and start this app
npm install
cp .env.example .env    # defaults already point at localhost:11434 / gemma3:4b
npm start
```

Then open **http://localhost:3000**.

If Ollama isn't reachable, or the configured model hasn't been pulled yet,
the app still starts and the UI loads, but upload is disabled with a clear
on-screen message — it won't pretend to work and then fail silently.

## How a request flows

1. **Upload** — drag-and-drop or browse, multipart upload straight into memory
   (`multer` memory storage — nothing touches disk).
2. **Parse** — format-specific parser extracts a plain-JSON content model:
   - DOCX → `mammoth` → heading/paragraph/list/table blocks
   - XLSX/CSV → `exceljs` / hand-rolled CSV parser → sheet rows
   - PPTX → raw OOXML read via `jszip` (slide title/bullets/notes — no
     general PPTX parser exists on npm, so this reads `slideN.xml` directly)
   - PDF → `pdf-parse` → paragraph/heading blocks (heuristic heading
     detection, since PDF has no semantic structure)
   - TXT → split on blank lines
3. **AI edit** — the content model (not the raw file) goes to the local model
   (via Ollama) with a format-specific system prompt instructing it to
   preserve every fact/number and only improve clarity, grammar, and
   structure, returning the *same JSON shape* back. An optional custom
   instruction is layered on top.
4. **Build** — the edited JSON model is turned back into a real file:
   - DOCX via `docx` (proper styles, numbering, table widths)
   - XLSX via `exceljs` (header styling, autosize, freeze pane, autofilter)
   - PPTX via `pptxgenjs` (clean slide layout, speaker notes)
   - PDF via `pdf-lib` with hand-rolled word-wrap/pagination (pdf-lib has no
     text-flow layer built in)
   - TXT via plain string joins
5. **Download** — a one-time job id is handed to the browser; the actual
   bytes are streamed on `/api/download/:jobId` and the job is deleted from
   memory immediately after.

## Project layout

```
server/
  index.js              Express app entry point
  routes/edit.js         /api/edit and /api/download/:jobId
  lib/ollama.js          local model client via Ollama (chat + JSON-mode helper)
  lib/aiEdit.js          format-specific system prompts + AI calls
  lib/fileTypes.js       extension → format metadata / routing
  lib/parsers/*.js       file → structured JSON
  lib/builders/*.js      structured JSON → file
public/
  index.html             single-page UI (upload / processing / done / error)
  styles.css             design system
  app.js                 drag-drop, fetch calls, state machine
```

## Known limitations worth knowing about

- **Large files**: content over ~60,000 JSON characters is rejected with a
  clear error rather than silently truncated or sent in costly/unreliable
  chunks. Very large spreadsheets or long documents may hit this.
- **PDF round-trip is lossy in one direction**: PDF has no real document
  structure, so headings are detected heuristically (short, title-cased,
  unpunctuated lines). Complex multi-column or heavily designed PDFs will
  lose their original visual layout — the *rebuilt* PDF is a clean, readable
  single-column document, not a pixel copy of the original.
- **PPTX parsing reads text only**: titles, body bullets, and speaker notes
  round-trip; original images, charts, and custom slide layouts/themes do
  not carry over — the rebuilt deck uses a clean default layout per slide.
- **No persistence**: closing the server clears all in-flight jobs. This is
  intentional given "no login" — there's no user to own long-term storage.
- **Single model call per file**: no chunking/map-reduce for very long
  documents (see size limit above) — kept deliberately simple per the agreed
  scope.
- **Local model quality varies**: small models (the kind most people can run
  comfortably on a laptop, like `gemma3:4b`) are noticeably less reliable
  than large hosted models at strictly following "return the exact same JSON
  shape" instructions, especially on long or structurally complex documents.
  If edits come back malformed often, try a larger model (see `.env.example`).
