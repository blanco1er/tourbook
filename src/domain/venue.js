// Reverse mode: a venue types its neighbourhood and gets acts to book.
// Same taste graph, other side of the booking market.
export async function venueMode(qloo, { neighborhood, popularityMax = 0.7, entityType = 'urn:entity:artist', take = 12 }) {
  if (!neighborhood) throw new Error('neighborhood is required');
  const first = await askQloo(qloo, { query: neighborhood, entityType, popularityMax, take });
  // Live data (30 Oct): East Austin, RiNo and Mississippi Ave resolve but carry too little signal (0 acts).
  // Then the room gets its city instead, and the UI says so.
  if (first.acts.length || !first.locality?.disambiguation) return { neighborhood, resolvedLocality: first.locality, popularityMax, acts: first.acts, provenance: first.provenance, widenedTo: null };
  const parts = first.locality.disambiguation.split(/,\s*/);
  const ci = parts.findIndex((x) => /County$/.test(x));
  const city = ci > 0 ? parts[ci - 1] : parts[parts.length - 3];
  const state = parts[parts.length - 2];
  if (!city || city === parts[0]) return { neighborhood, resolvedLocality: first.locality, popularityMax, acts: [], provenance: first.provenance, widenedTo: null };
  const wide = await askQloo(qloo, { query: `${city}, ${state}`, entityType, popularityMax, take });
  return { neighborhood, resolvedLocality: first.locality, popularityMax, acts: wide.acts, provenance: wide.provenance, widenedTo: city };
}

async function askQloo(qloo, { query, entityType, popularityMax, take }) {
  const { body, provenance } = await qloo.insights({
    'filter.type': entityType,
    'signal.location.query': query, // 400 if Qloo cannot resolve the locality
    'filter.popularity.max': popularityMax, // emerging acts the room can actually afford
    // Live data: without it, a sports team, a painter and a record label came back as "artists".
    ...(entityType === 'urn:entity:artist' ? { 'filter.external.exists': 'spotify' } : {}),
    take: take + 12, // headroom for the filters below
  });
  // Live data (30 Oct, Lower East Side): a photographer, a supermodel and a burlesque dancer came back as "artists"
  // even with a Spotify link. Qloo's own description says what the entity is first: if that first role is not a
  // music role, it is not a bookable act. Aliases fold duplicates ("Justin Bond" / "Justin Vivian Bond").
  const seen = new Set();
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const acts = (body?.results?.entities || [])
    .filter((e) => /[A-Za-z]/.test(e.name || '') && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(e.name || '')) // CJK-script acts: not bookable by a US room
    .filter((e) => entityType !== 'urn:entity:artist' || isMusicAct(e))
    .filter((e) => {
      const names = [e.name, ...(Array.isArray(e.properties?.aliases) ? e.properties.aliases : [])].map((x) => norm(typeof x === 'string' ? x : x?.value || x?.name)).filter(Boolean);
      const desc = String(e.properties?.description || '');
      if (names.some((n) => seen.has(n)) || [...seen].some((n) => n.includes(' ') && norm(desc).includes(`known as ${n}`))) return false;
      names.forEach((n) => seen.add(n)); return true;
    })
    .slice(0, take)
    .map((e) => ({
      id: e.entity_id, name: e.name, type: e.subtype, popularity: e.popularity, affinity: e?.query?.affinity,
      genres: (Array.isArray(e.properties?.primary_genres) ? e.properties.primary_genres : []).slice(0, 3),
      description: e?.properties?.short_description,
    }));
  const locality = body?.query?.locality?.signal || body?.query?.localities?.signal || null;
  return { acts, locality, provenance };
}

// First role in Qloo's description ("X is a British supermodel, actress, and singer…" → supermodel).
const NON_MUSIC = /^(?:stand up|standup|comic|drag|podcaster|host|photographer|pastor|preacher|televangelist|minister|priest|(?:super)?model|actor|actress|fashion|designer|painter|visual|sculptor|author|writer|novelist|poet|chef|athlete|footballer|basketball|skater|skateboarder|influencer|youtuber|tiktoker|politician|entrepreneur|businessman|businesswoman|director|filmmaker|dancer|burlesque|television|tv|reality|journalist|curator|architect|comedian|stylist|makeup|brand|clothing|magazine|restaurant|bar|club|venue|record label|label|festival|team)/;
const ADJ = /^(?:a|an|the|american|british|english|german|french|canadian|australian|japanese|korean|italian|spanish|swedish|irish|scottish|dutch|belgian|brazilian|mexican|nigerian|jamaican|new york|new york based|brooklyn|brooklyn based|los angeles based|london based|chicago based|renowned|acclaimed|famous|celebrated|influential|legendary|iconic|prolific|contemporary|multi|multidisciplinary|award winning|grammy winning|former|independent|emerging|young|veteran|pioneering|world renowned)\b\s*/;
function isMusicAct(e) {
  const d = String(e.properties?.description || '');
  const m = d.match(/\b(?:is|was|are|were)\s+(?:an?|the)\s+([^.,;]{0,90})/i);
  if (!m) return true; // no description: keep (most small acts have none)
  let role = m[1].toLowerCase().replace(/[-–]/g, ' ');
  for (let i = 0; i < 6; i++) { const r = role.replace(ADJ, ''); if (r === role) break; role = r; }
  return !NON_MUSIC.test(role);
}
