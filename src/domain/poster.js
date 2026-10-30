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

// Each act gets its own art direction (owner, 30 Oct: "the posters all look the same"). The planner model reads the
// act's Qloo data and writes a brief; without a model, a per-genre style table keeps the posters distinct.
const GENRE_STYLES = [
  [/hip ?hop|rap|trap|drill|grime/i, 'bold street-poster collage: spray paint, wheat-paste paper, halftone, neon signage glow at night', 'deep black, electric violet, acid yellow, chrome'],
  [/r&b|soul|neo.?soul|funk/i, 'velvet late-night lounge mood, soft film grain, smoky light, 1970s soul record sleeve feel', 'burgundy, gold, warm amber, deep plum'],
  [/dream ?pop|shoegaze|bedroom|lo.?fi|sophisti/i, 'soft-focus pastel watercolour, hazy dreamlike light, airy and nostalgic', 'lavender, peach, sky blue, cream'],
  [/psych|krautrock|space rock/i, 'swirling 1970s psychedelic gig-poster art, liquid shapes, sun bursts', 'saturated teal, magenta, tangerine, mustard'],
  [/metal|hardcore|punk|grunge|post.?hardcore|metalcore/i, 'stark woodcut and engraving style, high contrast, raw textures', 'black, bone white, blood red'],
  [/electro|house|techno|edm|dance|trance|ambient|synth/i, 'generative light: flowing laser lines, particles and grids, club atmosphere', 'ultraviolet, cyan, hot pink on black'],
  [/country|americana|folk|bluegrass|singer.?songwriter/i, 'vintage Americana screen-print, open landscapes, letterpress texture', 'denim blue, rust, sage, warm paper'],
  [/jazz|blues|swing/i, 'mid-century modern jazz-record geometry, bold flat shapes, smoky club', 'cobalt blue, black, cream, a touch of red'],
  [/indie|alternative|rock/i, 'risograph indie gig-poster, layered paper cut-outs, slightly offset inks', 'forest green, coral, off-white, navy'],
  [/pop/i, 'glossy modern pop art, bold colour fields, playful shapes', 'bubblegum pink, electric blue, sunshine yellow'],
  [/comedy|stand.?up|humou?r/i, 'warm comedy-club stage: spotlight, brick wall, vintage microphone, theatrical curtain', 'deep red, warm spotlight yellow, black'],
  [/podcast|talk|true crime|news/i, 'editorial studio mood: sound waves, vintage radio, headphones, clean graphic shapes', 'midnight blue, signal red, cream'],
];
function genreStyle(genres = [], kind = 'artist') {
  const g = genres.join(' ') + (kind === 'person' ? ' comedy' : kind === 'podcast' ? ' podcast' : '');
  const hit = GENRE_STYLES.find(([re]) => re.test(g));
  return hit ? { style: hit[1], palette: hit[2] } : { style: 'contemporary gig-poster illustration, rich texture', palette: 'a bold palette that fits the act' };
}

async function artDirection(llm, { name, kind, genres, description, themes }) {
  const base = genreStyle(genres, kind);
  if (!llm || llm.kind === 'mock') return { ...base, motifs: themes.slice(0, 5).join(', '), mood: '' };
  try {
    const r = await llm.chat({
      json: true,
      messages: [
        { role: 'system', content: 'You are the art director of a premium concert-poster studio. Return JSON only: {"style": string, "palette": string, "motifs": string, "mood": string}. The artwork will have NO text, NO letters, NO people, NO faces, NO hands (the real photo of the act and the type are added later). Make the direction specific to this act and different from a generic road-trip poster; choose the palette from the act itself, not orange by default.' },
        { role: 'user', content: JSON.stringify({ act: name, kind, genres, about: description, audience_tastes: themes.slice(0, 8), suggested_style: base.style }) },
      ],
    });
    const d = JSON.parse(r.content || '{}');
    const ok = (v) => typeof v === 'string' && v.trim().length > 3;
    return { style: ok(d.style) ? d.style : base.style, palette: ok(d.palette) ? d.palette : base.palette, motifs: ok(d.motifs) ? d.motifs : themes.slice(0, 5).join(', '), mood: ok(d.mood) ? d.mood : '' };
  } catch { return { ...base, motifs: themes.slice(0, 5).join(', '), mood: '' }; }
}

export function posterPrompt(dir) {
  return [
    'Background artwork for a concert tour poster, portrait 4:5, premium print quality.',
    'Absolutely no text, no letters, no numbers, no logos, no signs. No people, no faces, no hands, no silhouettes of people.',
    `Art style: ${dir.style}.`,
    `Palette: ${dir.palette}.`,
    dir.motifs ? `Motifs: ${dir.motifs}.` : '',
    dir.mood ? `Mood: ${dir.mood}.` : '',
    'Composition: the upper third and the lower half stay calmer and darker so white type stays readable; the strongest detail sits in the middle band. Not childish, not clip-art, not a photo collage.',
  ].filter(Boolean).join(' ');
}

const hashOf = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 20);
export const posterFile = (hash) => (/^[a-f0-9]{20}$/.test(hash) ? resolve(CACHE, `${hash}.png`) : null);

/** Returns { hash, cached, model } once the art exists on disk. Throws with a status when it cannot be made. */
export async function posterArt({ entityId, name, description, kind, genres, themes, cities, beforeGenerate, llm }) {
  const hash = hashOf({ v: 2, entityId, kind, genres, themes, cities }); // one image per act and tour
  const file = posterFile(hash);
  if (existsSync(file)) return { hash, cached: true, model: null };
  const key = imageKey(); const model = await imageModel();
  if (!key || !model) throw Object.assign(new Error('No image model is available on this server.'), { status: 503, code: 'no_image_model' });
  beforeGenerate?.(); // daily caps are checked only when a new image would be paid for
  const dir = await artDirection(llm, { name, kind, genres, description, themes });
  const prompt = posterPrompt(dir);
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
  return { hash, cached: false, model, prompt, direction: dir };
}

export const readPoster = (hash) => { const f = posterFile(hash); return f && existsSync(f) ? readFileSync(f) : null; };
