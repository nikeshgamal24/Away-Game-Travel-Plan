// The only module that talks to Aivana.
//
// Endpoints and behaviour follow developers.aivana.ai/docs:
//   POST {base}/generate          JSON body; structured output via response_format
//   POST {base}/generate:stream   same body, server-sent events (delta / done / error)
//   Auth header: X-API-Key. Retry only 429, 502, 504 and network failures,
//   honouring Retry-After / retry_after_ms.
//
// Mock mode (AIVANA_MOCK=1, or no API key) returns canned answers so the app
// can be demoed offline. The UI shows a MOCK badge when it is on.

const RETRYABLE = new Set([429, 502, 504]);
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 60_000;

const baseUrl = () => (process.env.AIVANA_BASE_URL || "https://api.aivana.ai/v1").replace(/\/+$/, "");

// Token accounting for the session, shown in the UI header.
export const USAGE = { calls: 0, input_tokens: 0, output_tokens: 0, cache_hits: 0, by_kind: {} };

// Swappable for tests: (url, init) => Response
let fetchImpl = (...args) => fetch(...args);
let sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms));
export function _setTransport({ fetch: f, sleep } = {}) {
  if (f) fetchImpl = f;
  if (sleep) sleepImpl = sleep;
}

export class AivanaError extends Error {
  constructor(message, { status = null, code = null, requestId = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
  toJSON() {
    return { error: this.message, status: this.status, code: this.code, request_id: this.requestId };
  }
}

export const apiKey = () => process.env.AIVANA_API_KEY || null;
export const mockMode = () => ["1", "true", "yes"].includes((process.env.AIVANA_MOCK || "").toLowerCase()) || !apiKey();

const headers = () => ({ "X-API-Key": apiKey(), "Content-Type": "application/json" });

const MESSAGES = {
  401: "Aivana rejected the API key (401). Check AIVANA_API_KEY.",
  402: "Aivana credit balance is empty (402).",
  403: "This API key is not allowed to make that request (403).",
  413: "Request too large for Aivana (413). Shorten the input.",
  422: "Aivana could not use the request or schema (422).",
  429: "Aivana rate limit reached (429). Please wait a moment and try again.",
  502: "Aivana could not produce an answer (502). Try again.",
  504: "Aivana timed out (504). Try again.",
};

function friendly(status, body) {
  body = body && typeof body === "object" ? body : {};
  const err = body.error && typeof body.error === "object" ? body.error : body;
  let msg = MESSAGES[status] || `Aivana error (${status}).`;
  if (err.message) msg += ` Details: ${err.message}`;
  return new AivanaError(msg, { status, code: err.code ?? null, requestId: err.request_id ?? body.request_id ?? null });
}

function waitSeconds(resp, body, attempt) {
  const ra = resp?.headers?.get?.("Retry-After");
  if (ra && !Number.isNaN(Number(ra))) return Number(ra);
  const err = body?.error && typeof body.error === "object" ? body.error : (body || {});
  if (err.retry_after_ms) return err.retry_after_ms / 1000;
  return 2 ** attempt + Math.random(); // 1-2s, 2-3s, 4-5s ...
}

async function post(path, body) {
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let resp = null, data = null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      resp = await fetchImpl(`${baseUrl()}/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body),
        signal: ctrl.signal });
    } catch (exc) { // network failure: retryable
      last = new AivanaError(`Could not reach Aivana: ${exc.name || "network error"}.`);
    } finally {
      clearTimeout(timer);
    }
    if (resp) {
      if (resp.status < 400) return resp;
      try { data = await resp.json(); } catch { data = {}; }
      last = friendly(resp.status, data);
      if (!RETRYABLE.has(resp.status) || last.code === "spend_limit_reached") throw last;
    }
    if (attempt < MAX_ATTEMPTS - 1) await sleepImpl(Math.min(waitSeconds(resp, data, attempt), 10) * 1000);
  }
  throw last;
}

function track(usage, kind = "other") {
  USAGE.calls += 1;
  const k = (USAGE.by_kind[kind] ??= { calls: 0, input_tokens: 0, output_tokens: 0 });
  k.calls += 1;
  if (usage) {
    for (const f of ["input_tokens", "output_tokens"]) {
      const n = Math.trunc(Number(usage[f]) || 0);
      USAGE[f] += n;
      k[f] += n;
    }
  }
}

/** Thrown by a `validate` function when Aivana's answer breaks one of our rules. */
export class InvalidAnswer extends Error {}

// ---------------------------------------------------------------- web search (Feature 7)
// From developers.aivana.ai/docs/parameters: `web_search` (boolean) "true searches the web first".
// TODO confirm: the docs show only this boolean, with no search options.
export function webSearchOptions() {
  return { web_search: true };
}
// TODO confirm: developers.aivana.ai/docs/responses-usage lists no sources/citations field
// (id, request_id, answer, usage, latency_ms, finish_reason, notices, structured, structured_error, trace).
// We read the likely shapes in case one appears; today this returns []. The app never relies on it:
// every hotel link is opened and checked by our own code (src/webCheck.js).
export function extractSources(data) {
  const raw = [data?.sources, data?.citations, data?.trace?.sources, data?.trace?.citations].find(Array.isArray) || [];
  return raw.map((x) => (typeof x === "string" ? { url: x, title: "" } : { url: String(x?.url || ""), title: String(x?.title || "") }))
    .filter((x) => /^https?:\/\//.test(x.url));
}

/** Pull a JSON object out of answer text (handles ```json fences and text around it). */
export function jsonFromText(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** One structured-output call. Returns the validated object.
 * `validate` runs our own checks on top of Aivana's schema validation; if it
 * throws InvalidAnswer we retry once with the problem stated, then give up. */
export async function structured({ system, messages, schema, maxTokens = 600, kind = "other", mock = null, validate = null,
  webSearch = false, onRaw = null, attachments = null }) {
  if (mockMode()) {
    track(null, kind);
    const out = mock ? mock() : {};
    if (validate) validate(out);
    return out;
  }
  let body = {
    system,
    messages: messages.slice(-12), // keep history short to save tokens
    response_format: { type: "json_schema", schema },
    max_tokens: maxTokens,
    effort: "low",
    ...(webSearch ? webSearchOptions() : {}),
    // Feature 8: files go in a top-level array, [{ mime_type, data (raw base64) }] (developers.aivana.ai/docs/files-documents).
    ...(attachments?.length ? { attachments } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let data;
    try {
      data = await (await post("generate", body)).json();
    } catch (e) {
      // TODO confirm: the docs don't say whether web_search works with response_format. If Aivana refuses
      // the pair, ask for the same JSON in plain text instead (validated by our code just the same).
      // Feature 8: attachments + response_format worked together in a live run (docs/evidence/schedule-image-*.md).
      // The fallback stays in case a workspace or model refuses the pair.
      if (!((webSearch || attachments?.length) && e instanceof AivanaError && [400, 422].includes(e.status) &&
        body.response_format)) throw e;
      const { response_format: _, ...rest } = body;
      body = { ...rest, system: `${system}\n\nReply with only a JSON object that matches this JSON Schema, and nothing else:\n` +
        JSON.stringify(schema) };
      data = await (await post("generate", body)).json();
    }
    track(data.usage, kind);
    if (onRaw) onRaw({ request: body, response: data, sources: extractSources(data) });
    let out = data.structured ?? null;
    if (out === null) {
      try { out = JSON.parse(data.answer || ""); } catch { out = jsonFromText(data.answer); }
    }
    try {
      if (!out || typeof out !== "object" || Array.isArray(out)) throw new InvalidAnswer("Response was not a JSON object.");
      if (validate) validate(out);
      return out;
    } catch (exc) {
      if (!(exc instanceof InvalidAnswer)) throw exc;
      if (attempt === 1) {
        throw new AivanaError(`Aivana's answer failed our checks: ${exc.message}`, { code: "app_validation",
          requestId: data.request_id ?? null });
      }
      body = { ...body, messages: [...body.messages,
        { role: "assistant", content: data.answer || "" },
        { role: "user", content: `That answer was invalid: ${exc.message} Answer again, following the rules.` }] };
    }
  }
  throw new AivanaError("Unreachable");
}

/** Stream plain text from /generate:stream. Yields text pieces. */
export async function* stream({ system, messages, maxTokens = 700, kind = "other", mock = null }) {
  if (mockMode()) {
    track(null, kind);
    const text = mock ? mock() : "";
    for (const word of text.split(" ")) {
      await sleepImpl(20);
      yield word + " ";
    }
    return;
  }
  const body = { system, messages: messages.slice(-12), max_tokens: maxTokens, effort: "low" };
  const resp = await post("generate:stream", body);
  const decoder = new TextDecoder();
  let buf = "", event = null;
  const handle = (raw) => {
    const line = raw.trim();
    if (!line) { event = null; return null; }
    if (line.startsWith("event:")) { event = line.slice(6).trim(); return null; }
    if (!line.startsWith("data:")) return null;
    const payload = line.slice(5).trim();
    let data;
    try { data = payload ? JSON.parse(payload) : {}; } catch { data = {}; }
    const ev = event || data.type;
    if (ev === "delta") return { text: data.text || "" };
    if (ev === "done") { track(data.usage, kind); return { done: true }; }
    if (ev === "error") throw friendly(data.status || 502, data);
    return null;
  };
  for await (const chunk of resp.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r\n|\r|\n/);
    buf = lines.pop();
    for (const raw of lines) {
      const r = handle(raw);
      if (r?.done) return;
      if (r?.text) yield r.text;
    }
  }
  if (buf) {
    const r = handle(buf);
    if (r?.done) return;
    if (r?.text) yield r.text;
  }
  track(null, kind);
}
