#!/usr/bin/env node
// Prints a compact, model-friendly summary of one Mitti API reference page.
//   node scripts/api-ref.mjs actionsservice_getactions [more slugs...]
// Slugs are the file names listed at https://developer.mitti.com/llms.txt (without .md).
// Pages are cached in .cache/api-ref/. Output: method, path, parameters, request body fields
// (resolved $refs, depth-limited) and the 200 response fields.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "api-ref");
const MAX_DEPTH = Number(process.env.DEPTH ?? 4);

async function load(slug) {
  const file = join(CACHE, `${slug}.md`);
  try {
    return await readFile(file, "utf8");
  } catch {
    const res = await fetch(`https://developer.mitti.com/reference/${slug}.md`);
    if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, text);
    return text;
  }
}

function extractSpec(md) {
  const start = md.indexOf('{\n  "openapi"') >= 0 ? md.indexOf('{\n  "openapi"') : md.indexOf('"openapi"') - 4;
  const fence = md.indexOf("\n```", start);
  return JSON.parse(md.slice(start, fence > start ? fence : undefined));
}

function intro(md) {
  const end = md.indexOf("```");
  return md.slice(0, end > 0 ? end : 1500).replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
}

function render(spec, schema, depth, seen = new Set()) {
  if (!schema) return "?";
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    if (seen.has(name) || depth > MAX_DEPTH) return `<${name.split(".").pop()}>`;
    return render(spec, spec.components.schemas[name], depth, new Set([...seen, name]));
  }
  if (schema.allOf) return schema.allOf.map((s) => render(spec, s, depth, seen)).join(" & ");
  if (schema.type === "array") return `${render(spec, schema.items, depth, seen)}[]`;
  if (schema.enum) return `enum(${schema.enum.join("|")})`;
  if (schema.type === "object" || schema.properties) {
    const pad = "  ".repeat(depth + 1);
    const props = Object.entries(schema.properties ?? {});
    if (!props.length) return "object";
    return (
      "{\n" +
      props
        .map(([k, v]) => {
          const desc = (v.description ?? "").split("\n")[0].slice(0, 110);
          return `${pad}${k}: ${render(spec, v, depth + 1, seen)}${desc ? `  # ${desc}` : ""}`;
        })
        .join("\n") +
      `\n${"  ".repeat(depth)}}`
    );
  }
  return schema.format ? `${schema.type}(${schema.format})` : schema.type ?? "any";
}

for (const slug of process.argv.slice(2)) {
  const md = await load(slug);
  const spec = extractSpec(md);
  console.log(`\n==================== ${slug}`);
  console.log(intro(md));
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      console.log(`\n${method.toUpperCase()} ${path}   (${op.summary ?? ""})`);
      for (const p of op.parameters ?? []) {
        console.log(`  param ${p.in}:${p.name}${p.required ? "*" : ""} ${render(spec, p.schema, 1)}  # ${(p.description ?? "").split("\n")[0].slice(0, 120)}`);
      }
      const body = op.requestBody?.content?.["application/json"]?.schema;
      if (body) console.log(`  body: ${render(spec, body, 1)}`);
      const ok = op.responses?.["200"]?.content?.["application/json"]?.schema;
      if (ok) console.log(`  200: ${render(spec, ok, 1)}`);
    }
  }
}
