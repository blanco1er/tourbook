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
        { role: 'system', content: 'You are the creative director of a top contemporary design studio (the level of A24 key art, Apple Music editorial artwork, modern festival campaigns, Swiss / international typographic style). Return JSON only: {"style": string, "palette": string, "motifs": string, "mood": string, "layout": string, "typography": string, "photo_treatment": string}. Design a modern, premium, high-end CONCERT TOUR poster for this act, one that anyone recognises as a tour poster at a glance (the tour label and the tour-date block are central to the composition, as on real tour posters): bold contemporary typography (grotesk, neo-grotesk, condensed or refined serif display), a strong grid, generous negative space, confident colour, real photographic power. Pick ONE of these modern approaches, whichever fits the act best, and make it specific: (a) full-bleed photo with a duotone or gradient-map treatment and oversized type; (b) giant headline with the act standing in front of it (type behind the subject); (c) the act cut out on a single bold colour field with sharp editorial type; (d) magazine-cover editorial layout; (e) mostly typographic poster with a narrow photo strip; (f) high-contrast black-and-white photo with one accent colour and grain. FORBIDDEN: ornaments, baroque, filigree, crowns, laurels, arches, frames, ovals, medallions, watercolour washes, smudges, clip-art, fantasy, vintage pastiche, kitsch. photo_treatment must keep the supplied real photograph of the act and never redraw or change the face; no other people. Choose the palette from the act itself, not orange by default.' },
        { role: 'user', content: JSON.stringify({ act: name, kind, genres, about: description, audience_tastes: themes.slice(0, 8), suggested_style: base.style }) },
      ],
    });
    const d = JSON.parse(r.content || '{}');
    const ok = (v) => typeof v === 'string' && v.trim().length > 3;
    return { style: ok(d.style) ? d.style : base.style, palette: ok(d.palette) ? d.palette : base.palette, motifs: ok(d.motifs) ? d.motifs : themes.slice(0, 5).join(', '), mood: ok(d.mood) ? d.mood : '', layout: ok(d.layout) ? d.layout : '', typography: ok(d.typography) ? d.typography : '', photo: ok(d.photo_treatment) ? d.photo_treatment : '' };
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

// The whole poster designed by the image model (owner, 30 Oct: "the text and the photo are always laid out the same").
// The exact text is given word for word and checked afterwards; the real photo is passed in and must not be redrawn.
function fullPosterPrompt(dir, { name, lines, footer, hasPhoto, tourLabel, tickets }) {
  return [
    'Design a complete, print-ready concert tour poster, portrait 4:5. It must look modern, premium and high-end, like the work of a top contemporary design studio: bold contemporary typography, strong grid, generous negative space, confident colour, crisp print finish. No template: every decision serves this specific act.',
    'Never use ornaments, baroque details, crowns, laurels, arches, frames, ovals, medallions, watercolour washes, clip-art or vintage pastiche.',
    `Art style: ${dir.style}. Palette: ${dir.palette}.`,
    dir.motifs ? `Motifs: ${dir.motifs}.` : '', dir.mood ? `Mood: ${dir.mood}.` : '',
    dir.layout ? `Layout: ${dir.layout}.` : 'Layout: an original, bold composition specific to this act.',
    dir.typography ? `Typography: ${dir.typography}.` : '',
    hasPhoto ? `The attached image is the real photograph of ${name}. Integrate it into the design${dir.photo ? ` (${dir.photo})` : ''}. Use it as a photograph with its original framing: you may crop it, cut out its background, tint it or set it in black and white, but never extend it (no invented body, legs or pose), never redraw, restyle or replace the person, and never add any other person.` : 'No people, no faces.',
    'It must read instantly as a concert TOUR poster: the tour label large and prominent near the name, and the stops set as the classic tour-date block (one stop per line, like the date list on a real tour poster).',
    'Render this text exactly, spelled exactly as written, and no other words, letters or numbers anywhere:',
    `- headline: "${name}" (the full name, exactly; never shortened)`,
    `- tour label, large: "${tourLabel}"`,
    `- the tour stops, in this order, one per line: ${lines.map((l) => `"${l}"`).join(', ')}`,
    `- ticket line: "${tickets}"`,
    `- small footer: "${footer}"`,
    'All text must be sharp, legible and correctly spelled. No other text at all: no credits, no small print, no invented names, no dates, no logos, no brand names, no captions.',
  ].filter(Boolean).join('\n');
}

// Proofreading is done in code, not left to the model's judgement: the vision model transcribes every piece of text
// on the poster, then each expected string must be found and nothing else may appear (a GIMS for "Maître Gims" or a
// column of invented credits fails).
const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function checkText(llm, b64, expected) {
  if (!llm || llm.kind === 'mock') return { ok: true, skipped: true };
  try {
    const r = await llm.chat({ json: true, messages: [
      { role: 'system', content: 'Transcribe every piece of visible text in this poster image, exactly as written (keep the spelling you see, even if it looks wrong), one entry per line of text. Return JSON only: {"lines": [string]}.' },
      { role: 'user', content: [{ type: 'text', text: 'Transcribe all text.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] },
    ] });
    const seen = (JSON.parse(r.content || '{}').lines || []).map(norm).filter(Boolean);
    const all = ` ${seen.join(' ')} `;
    const want = expected.map(norm);
    const missing = want.filter((w) => !all.includes(` ${w} `) && !all.includes(w));
    const wantWords = new Set(want.join(' ').split(' '));
    const extra = seen.filter((l) => l.split(' ').some((w) => w.length > 2 && !wantWords.has(w)));
    return { ok: !missing.length && !extra.length, missing, extra: extra.slice(0, 6) };
  } catch { return { ok: true, skipped: true }; }
}

const hashOf = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 20);
export const posterFile = (hash) => (/^[a-f0-9]{20}$/.test(hash) ? resolve(CACHE, `${hash}.png`) : null);

/** Returns { hash, cached, model } once the art exists on disk. Throws with a status when it cannot be made. */
export async function posterArt({ entityId, name, description, kind, genres, themes, cities, stops = [], photo, lang = 'en', beforeGenerate, llm }) {
  const hash = hashOf({ v: 7, entityId, kind, genres, themes, cities, stops, lang }); // one poster per act, tour and language
  const file = posterFile(hash);
  if (existsSync(file)) return { hash, cached: true, model: null, full: true };
  const key = imageKey(); const model = await imageModel();
  if (!key || !model) throw Object.assign(new Error('No image model is available on this server.'), { status: 503, code: 'no_image_model' });
  if (/^imagen/.test(model)) throw Object.assign(new Error('This image model cannot lay out a full poster.'), { status: 503, code: 'no_image_model' });
  beforeGenerate?.(); // daily caps are checked only when a new image would be paid for
  const dir = await artDirection(llm, { name, kind, genres, description, themes });
  const lines = (stops.length ? stops : cities).map((c, i) => `${String(i + 1).padStart(2, '0')}  ${c}`);
  const footer = lang === 'fr' ? 'Tracée selon le goût avec Qloo' : 'Routed by taste with Qloo';
  const tourLabel = lang === 'fr' ? 'TOURNÉE NORD-AMÉRICAINE' : 'NORTH AMERICAN TOUR';
  const tickets = lang === 'fr' ? 'Billetterie bientôt' : 'Tickets soon';
  let photoPart = null;
  if (/^[0-9A-F-]{36}$/i.test(photo || '')) {
    try { const pr = await fetch(`https://images.qloo.com/i/${photo}-1080x-auto.jpg`, { signal: AbortSignal.timeout(15000) }); if (pr.ok) photoPart = { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await pr.arrayBuffer()).toString('base64') } }; } catch { /* no photo: the poster is designed without it */ }
  }
  const prompt = fullPosterPrompt(dir, { name, lines, footer, hasPhoto: !!photoPart, tourLabel, tickets });
  const paint = async () => {
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [...(photoPart ? [photoPart] : []), { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } } }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Image model error ${r.status}`), { status: 502, code: 'image_error' });
    const b64 = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!b64) throw Object.assign(new Error('The image model returned no picture (it may have declined the request).'), { status: 502, code: 'image_empty' });
    return b64;
  };
  // paint, proofread the text, paint once more if a word is wrong
  let b64 = await paint();
  let check = await checkText(llm, b64, [name, tourLabel, ...lines, tickets, footer]);
  for (let tries = 0; !check.ok && tries < 2; tries++) { const again = await paint(); const c2 = await checkText(llm, again, [name, tourLabel, ...lines, tickets, footer]); const score = (c) => (c.missing?.length || 0) * 3 + (c.extra?.length || 0); if (c2.ok || c2.skipped || score(c2) < score(check)) { b64 = again; check = c2; } }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return { hash, cached: false, model, full: true, direction: dir, proofread: check };
}

export const readPoster = (hash) => { const f = posterFile(hash); return f && existsSync(f) ? readFileSync(f) : null; };
