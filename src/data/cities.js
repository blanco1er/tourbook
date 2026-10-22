// Candidate tour markets (US metros). NOT Qloo data: public geography + population.
// Population = APPROXIMATE metro (MSA) population, US Census 2020, rounded.
// TODO(day 3): replace with the official Census CSV (cbsa-est2023-alldata) and cite it in the README.
// `query` is the string sent to signal.location.query / filter.location.query (fuzzy locality lookup).
export const CITIES = [
  { id: 'new-york', name: 'New York', state: 'NY', query: 'New York City', lat: 40.7128, lng: -74.006, pop: 20140000 },
  { id: 'los-angeles', name: 'Los Angeles', state: 'CA', query: 'Los Angeles', lat: 34.0522, lng: -118.2437, pop: 13200000 },
  { id: 'chicago', name: 'Chicago', state: 'IL', query: 'Chicago', lat: 41.8781, lng: -87.6298, pop: 9620000 },
  { id: 'dallas', name: 'Dallas', state: 'TX', query: 'Dallas', lat: 32.7767, lng: -96.797, pop: 7640000 },
  { id: 'houston', name: 'Houston', state: 'TX', query: 'Houston', lat: 29.7604, lng: -95.3698, pop: 7120000 },
  { id: 'washington', name: 'Washington', state: 'DC', query: 'Washington DC', lat: 38.9072, lng: -77.0369, pop: 6390000 },
  { id: 'philadelphia', name: 'Philadelphia', state: 'PA', query: 'Philadelphia', lat: 39.9526, lng: -75.1652, pop: 6250000 },
  { id: 'miami', name: 'Miami', state: 'FL', query: 'Miami', lat: 25.7617, lng: -80.1918, pop: 6140000 },
  { id: 'atlanta', name: 'Atlanta', state: 'GA', query: 'Atlanta', lat: 33.749, lng: -84.388, pop: 6090000 },
  { id: 'boston', name: 'Boston', state: 'MA', query: 'Boston', lat: 42.3601, lng: -71.0589, pop: 4940000 },
  { id: 'phoenix', name: 'Phoenix', state: 'AZ', query: 'Phoenix', lat: 33.4484, lng: -112.074, pop: 4850000 },
  { id: 'san-francisco', name: 'San Francisco', state: 'CA', query: 'San Francisco', lat: 37.7749, lng: -122.4194, pop: 4750000 },
  { id: 'seattle', name: 'Seattle', state: 'WA', query: 'Seattle', lat: 47.6062, lng: -122.3321, pop: 4020000 },
  { id: 'minneapolis', name: 'Minneapolis', state: 'MN', query: 'Minneapolis', lat: 44.9778, lng: -93.265, pop: 3690000 },
  { id: 'san-diego', name: 'San Diego', state: 'CA', query: 'San Diego', lat: 32.7157, lng: -117.1611, pop: 3300000 },
  { id: 'denver', name: 'Denver', state: 'CO', query: 'Denver', lat: 39.7392, lng: -104.9903, pop: 2960000 },
  { id: 'portland', name: 'Portland', state: 'OR', query: 'Portland, Oregon', lat: 45.5152, lng: -122.6784, pop: 2510000 },
  { id: 'pittsburgh', name: 'Pittsburgh', state: 'PA', query: 'Pittsburgh', lat: 40.4406, lng: -79.9959, pop: 2370000 },
  { id: 'austin', name: 'Austin', state: 'TX', query: 'Austin', lat: 30.2672, lng: -97.7431, pop: 2280000 },
  { id: 'kansas-city', name: 'Kansas City', state: 'MO', query: 'Kansas City', lat: 39.0997, lng: -94.5786, pop: 2190000 },
  { id: 'columbus', name: 'Columbus', state: 'OH', query: 'Columbus, Ohio', lat: 39.9612, lng: -82.9988, pop: 2140000 },
  { id: 'nashville', name: 'Nashville', state: 'TN', query: 'Nashville', lat: 36.1627, lng: -86.7816, pop: 1990000 },
  { id: 'raleigh', name: 'Raleigh', state: 'NC', query: 'Raleigh', lat: 35.7796, lng: -78.6382, pop: 1410000 },
  { id: 'richmond', name: 'Richmond', state: 'VA', query: 'Richmond, Virginia', lat: 37.5407, lng: -77.436, pop: 1310000 },
  { id: 'louisville', name: 'Louisville', state: 'KY', query: 'Louisville', lat: 38.2527, lng: -85.7585, pop: 1290000 },
  { id: 'new-orleans', name: 'New Orleans', state: 'LA', query: 'New Orleans', lat: 29.9511, lng: -90.0715, pop: 1270000 },
  { id: 'salt-lake-city', name: 'Salt Lake City', state: 'UT', query: 'Salt Lake City', lat: 40.7608, lng: -111.891, pop: 1260000 },
  { id: 'tucson', name: 'Tucson', state: 'AZ', query: 'Tucson', lat: 32.2226, lng: -110.9747, pop: 1040000 },
  { id: 'omaha', name: 'Omaha', state: 'NE', query: 'Omaha', lat: 41.2565, lng: -95.9345, pop: 970000 },
  { id: 'albuquerque', name: 'Albuquerque', state: 'NM', query: 'Albuquerque', lat: 35.0844, lng: -106.6504, pop: 920000 },
  { id: 'boise', name: 'Boise', state: 'ID', query: 'Boise', lat: 43.615, lng: -116.2023, pop: 760000 },
  { id: 'madison', name: 'Madison', state: 'WI', query: 'Madison, Wisconsin', lat: 43.0731, lng: -89.4012, pop: 680000 },
  { id: 'asheville', name: 'Asheville', state: 'NC', query: 'Asheville', lat: 35.5951, lng: -82.5515, pop: 470000 },
  { id: 'burlington', name: 'Burlington', state: 'VT', query: 'Burlington, Vermont', lat: 44.4759, lng: -73.2121, pop: 230000 },
];

export const CITY_BY_ID = Object.fromEntries(CITIES.map((c) => [c.id, c]));

// Contiguous-US bounding box as WKT (LONGITUDE first, per Qloo docs). Used for ONE nationwide heatmap call so
// that affinities are comparable across cities. Points that fall outside a candidate metro are discarded later.
export const US_WKT = 'POLYGON((-125 24.4, -66.9 24.4, -66.9 49.4, -125 49.4, -125 24.4))';

export function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
