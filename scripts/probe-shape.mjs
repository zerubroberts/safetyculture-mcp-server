// Prints only key names and value TYPES, never values.
const t = process.env.SC_API_TOKEN ?? process.env.SAFETYCULTURE_API_TOKEN;
const shape = (v, d = 0) => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1)] : [];
  if (v && typeof v === "object") { if (d > 3) return "{…}"; const o = {}; for (const [k, x] of Object.entries(v)) o[k] = shape(x, d + 1); return o; }
  return typeof v;
};
const [method, path, body] = process.argv.slice(2);
const r = await fetch("https://api.safetyculture.io" + path, { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body || undefined });
const txt = await r.text();
console.log(method, path, r.status, ["x-ratelimit-limit","x-ratelimit-remaining","x-ratelimit-reset"].map(h => h + "=" + r.headers.get(h)).join(" "));
try { console.log(JSON.stringify(shape(JSON.parse(txt)), null, 1).slice(0, 2500)); } catch { console.log("non-json", txt.length); }
