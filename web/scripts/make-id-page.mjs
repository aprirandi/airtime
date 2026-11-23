// Writes docs/id/index.html: the same app, served at /id/ so it starts in Indonesian.
// It reuses the English page's assets and data, one folder up.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

// Where the site was built: ../docs for GitHub Pages, or web/dist when AIRTIME_OUT=dist (Vercel).
const out = process.env.AIRTIME_OUT ?? "../docs"

const html = readFileSync(`${out}/index.html`, "utf8")
const id = html
  .replaceAll('="./assets/', '="../assets/')
  .replace('<html lang="en">', '<html lang="id">')
if (id === html || !id.includes('="../assets/')) throw new Error(`asset paths not found in ${out}/index.html`)
mkdirSync(`${out}/id`, { recursive: true })
writeFileSync(`${out}/id/index.html`, id)
console.log(`wrote ${out}/id/index.html`)
