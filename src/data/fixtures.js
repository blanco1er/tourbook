// SYNTHETIC fixtures for MOCK mode. Every name below is INVENTED. No Qloo data, no real artists,
// venues or brands. Safe to commit to a public repo (hackathon rule: fixtures must be synthetic).

// Demo artists: each has a "taste geography" (city id -> 0..1 weight) so the Hidden Market Score
// story is visible in mock mode (secondary markets that outperform their population).
export const DEMO_ARTISTS = [
  {
    name: 'Velvet Harbor', type: 'urn:entity:artist', popularity: 0.71,
    blurb: 'Dream-pop quartet with psych guitars (synthetic)',
    proxies: ['Lumen Coast', 'The Paper Tides', 'Soft Antenna'],
    tags: ['dream pop', 'psychedelic', 'shoegaze'],
    taste: { portland: 1, denver: 0.92, asheville: 0.95, madison: 0.85, boise: 0.82, 'salt-lake-city': 0.8, richmond: 0.78, austin: 0.75, seattle: 0.7, burlington: 0.72, minneapolis: 0.62, chicago: 0.9 },
  },
  {
    name: 'Marisol Vega', type: 'urn:entity:person', popularity: 0.64,
    blurb: 'Stand-up comedian, bilingual crowd work (synthetic)',
    proxies: ['Danny Ocampo', 'Rita Fuentes', 'The Late Shift Trio'],
    tags: ['stand-up comedy', 'observational', 'bilingual'],
    taste: { tucson: 1, albuquerque: 0.95, austin: 0.85, 'san-diego': 0.8, phoenix: 0.72, denver: 0.7, 'salt-lake-city': 0.55, omaha: 0.5 },
  },
  {
    name: 'Night Shift Radio', type: 'urn:entity:podcast', popularity: 0.58,
    blurb: 'True-crime-meets-folklore live podcast (synthetic)',
    proxies: ['Hollow Frequencies', 'The Lantern Files', 'Small Town Static'],
    tags: ['folklore', 'true crime', 'storytelling'],
    taste: { madison: 1, minneapolis: 0.9, pittsburgh: 0.88, columbus: 0.84, burlington: 0.9, richmond: 0.76, louisville: 0.7, omaha: 0.68 },
  },
  {
    name: 'Juniper Static', type: 'urn:entity:artist', popularity: 0.77,
    blurb: 'Analog-synth electronic duo (synthetic)',
    proxies: ['Glass Orchard', 'Neon Pastoral', 'Half Moon Signal'],
    tags: ['synthwave', 'electronic', 'ambient'],
    taste: { 'kansas-city': 0.95, 'salt-lake-city': 0.9, denver: 0.88, omaha: 0.85, seattle: 0.8, columbus: 0.78, raleigh: 0.7, boise: 0.66 },
  },
  {
    name: 'The Low Fidelity', type: 'urn:entity:artist', popularity: 0.66,
    blurb: 'Americana / alt-country five-piece (synthetic)',
    proxies: ['Copper Wren', 'Saint Delaney', 'The Gravel Choir'],
    tags: ['americana', 'alt-country', 'folk rock'],
    taste: { asheville: 1, louisville: 0.95, richmond: 0.9, nashville: 0.85, burlington: 0.82, boise: 0.8, raleigh: 0.74, 'new-orleans': 0.7 },
  },
];

const A = ['Amber', 'Cobalt', 'Velvet', 'Hollow', 'Silver', 'Paper', 'Copper', 'Glass', 'Lumen', 'Quiet', 'Saint', 'Neon', 'Wild', 'Static', 'Golden', 'Low', 'Northern', 'Soft', 'Juniper', 'Marigold'];
const B = ['Harbor', 'Orchard', 'Antenna', 'Choir', 'Tides', 'Wren', 'Signal', 'Pastoral', 'Lanterns', 'Motel', 'Atlas', 'Season', 'Parade', 'Arcade', 'Fever', 'Garden', 'Coast', 'Radio', 'Hours', 'Engine'];
export const SYNTH_ARTIST_NAMES = A.flatMap((a, i) => B.slice(i % 5, (i % 5) + 4).map((b) => `${a} ${b}`));

export const VENUE_PATTERNS = ['The {w} Room', '{w} Hall', 'The {w} Ballroom', '{w} Theatre', 'The {w} House', '{w} Music Hall', 'The {w} Club'];
export const AFTER_PATTERNS = ['{w} Tavern', 'Bar {w}', 'The {w} Social', '{w} Coffee & Records', 'The {w} Pour', '{w} Taproom', 'Little {w} Kitchen'];
export const VENUE_WORDS = ['Lantern', 'Foundry', 'Meridian', 'Sparrow', 'Ironwood', 'Bluebird', 'Halcyon', 'Union', 'Kestrel', 'Larkspur', 'Mercury', 'Driftwood', 'Cardinal', 'Orchid', 'Granite'];

export const SYNTH_BRANDS = ['Northpaw Coffee', 'Halcyon Seltzer', 'Fieldnote Denim', 'Kestrel Cycles', 'Bramble Tea Co.', 'Arcadia Audio', 'Lowtide Surf Supply', 'Juniper & Pine Outfitters', 'Moth Vinyl Club', 'Saltgrass Kombucha', 'Copperline Bikes', 'Quietude Headphones'];
export const SYNTH_SHOWS = ['The Long Weekend', 'Static Hearts', 'Paper Moon Motel', 'North of Ordinary', 'Small Hours', 'The Orchard Years', 'Signal Lost', 'Velvet County', 'The Overnighters', 'Kindred Roads'];
export const SYNTH_PODCASTS = ['Field Recordings', 'The Slow Burn Hour', 'Tiny Stages', 'Back Roads Audio', 'Liner Notes Live', 'The Third Encore'];
export const SYNTH_TAGS = ['vinyl culture', 'craft beer', 'thrift fashion', 'indie film', 'outdoor festivals', 'late-night diners', 'bookshops', 'cycling', 'board games', 'cold brew', 'record stores', 'stand-up nights', 'karaoke', 'farmers markets', 'tattoo culture', 'zines'];

export const NEIGHBORHOOD_SUGGESTIONS = ['Lower East Side', 'Wicker Park', 'Silver Lake', 'East Austin', 'RiNo, Denver', 'Mississippi Ave, Portland'];
