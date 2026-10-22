// Minimal geohash encode/decode (standard base32), used to map heatmap cells to metros.
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat, lng, precision = 6) {
  let latR = [-90, 90], lngR = [-180, 180], hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR, v = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

export function decodeGeohash(hash) {
  let latR = [-90, 90], lngR = [-180, 180], even = true;
  for (const c of hash.toLowerCase()) {
    const n = B32.indexOf(c);
    if (n < 0) break;
    for (let i = 4; i >= 0; i--) {
      const r = even ? lngR : latR, mid = (r[0] + r[1]) / 2;
      if ((n >> i) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (latR[0] + latR[1]) / 2, lng: (lngR[0] + lngR[1]) / 2 };
}
