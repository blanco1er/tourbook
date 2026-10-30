// Tour poster (30 Oct). The artwork is painted by an image model from the act's taste data (Qloo genres and the
// themes its audiences like in the tour cities); the type, cities and route are laid out by the app on top, so
// nothing on the poster is misspelled. The model is never asked for a person or a face: the act's photo on the
// poster is the real one Qloo provides. Art is generated only when someone asks for it, then kept on disk.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE = resolve(process.cwd(), process.env.POSTER_CACHE_DIR || '.cache/posters');

// The same Gemini key the planner uses on the server (OpenAI-compatible endpoint), or a dedicated one.
export function imageKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  return /generativelanguage\.googleapis\.com/.test(config.llm.baseUrl) ? config.llm.apiKey : '';
}

// Best image model this key can use, found once from the model list (a free call).
const PREFERRED = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001', 'imagen-3.0-generate-002', 'gemini-2.0-flash-preview-image-generation'];
let modelPromise = null;
export function imageModel() {
  if (process.env.IMAGE_MODEL) return Promise.resolve(process.env.IMAGE_MODEL);
  const key = imageKey();
  if (!key) return Promise.resolve(null);
  modelPromise ||= (async () => {
    try {
      const r = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
      const names = ((await r.json()).models || []).map((m) => m.name.replace(/^models\//, ''));
      return PREFERRED.find((p) => names.includes(p)) || names.find((n) => /image/.test(n) && !/embed/.test(n)) || null;
    } catch { modelPromise = null; return null; }
  })();
  return modelPromise;
}

export function posterPrompt({ kind = 'music', genres = [], themes = [], cities = [] }) {
  const g = genres.slice(0, 5).join(', ') || 'independent music';
  const th = themes.slice(0, 8).join(', ');
  return [
    'Background artwork for a concert tour poster, portrait 4:5.',
    'Absolutely no text, no letters, no numbers, no logos, no signs. No people, no faces, no hands, no silhouettes of people.',
    `The visual world of a ${kind === 'person' ? 'comedy' : kind === 'podcast' ? 'live podcast' : 'music'} act whose fans love ${g}.`,
    th ? `Weave in motifs from what its audiences like in these cities: ${th}.` : '',
    cities.length ? `A road-trip feeling across North America, through places like ${cities.slice(0, 6).join(', ')}, evoked by landscape and light, never by written names.` : '',
    'Modern premium gig-poster art: rich painterly and risograph texture, cinematic light, deep near-black and warm earth tones with one glowing warm orange accent.',
    'Keep calm, darker empty space in the upper third and the lower half for typography. Not childish, not clip-art, not a photo collage.',
  ].filter(Boolean).join(' ');
}

const hashOf = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 20);
export const posterFile = (hash) => (/^[a-f0-9]{20}$/.test(hash) ? resolve(CACHE, `${hash}.png`) : null);

/** Returns { hash, cached, model } once the art exists on disk. Throws with a status when it cannot be made. */
export async function posterArt({ entityId, kind, genres, themes, cities, beforeGenerate }) {
  const prompt = posterPrompt({ kind, genres, themes, cities });
  const hash = hashOf({ entityId, prompt });
  const file = posterFile(hash);
  if (existsSync(file)) return { hash, cached: true, model: null, prompt };
  const key = imageKey(); const model = await imageModel();
  if (!key || !model) throw Object.assign(new Error('No image model is available on this server.'), { status: 503, code: 'no_image_model' });
  beforeGenerate?.(); // daily caps are checked only when a new image would be paid for
  const imagen = /^imagen/.test(model);
  const r = await fetch(`${API}/models/${model}:${imagen ? 'predict' : 'generateContent'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(imagen
      ? { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '3:4' } }
      : { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } } }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Image model error ${r.status}`), { status: 502, code: 'image_error' });
  const b64 = imagen ? j?.predictions?.[0]?.bytesBase64Encoded : (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw Object.assign(new Error('The image model returned no picture (it may have declined the request).'), { status: 502, code: 'image_empty' });
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return { hash, cached: false, model, prompt };
}

export const readPoster = (hash) => { const f = posterFile(hash); return f && existsSync(f) ? readFileSync(f) : null; };
