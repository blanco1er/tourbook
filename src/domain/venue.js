// Reverse mode: a venue types its neighbourhood and gets acts to book.
// Same taste graph, other side of the booking market.
export async function venueMode(qloo, { neighborhood, popularityMax = 0.7, entityType = 'urn:entity:artist', take = 12 }) {
  if (!neighborhood) throw new Error('neighborhood is required');
  const { body, provenance } = await qloo.insights({
    'filter.type': entityType,
    'signal.location.query': neighborhood, // 400 if Qloo cannot resolve the locality
    'filter.popularity.max': popularityMax, // emerging acts the room can actually afford
    take,
  });
  const acts = (body?.results?.entities || []).map((e) => ({
    id: e.entity_id, name: e.name, type: e.subtype, popularity: e.popularity, affinity: e?.query?.affinity,
    description: e?.properties?.short_description,
  }));
  const locality = body?.query?.locality?.signal || body?.query?.localities?.signal || null;
  return { neighborhood, resolvedLocality: locality, popularityMax, acts, provenance };
}
