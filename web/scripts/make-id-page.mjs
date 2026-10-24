// Writes docs/id/index.html: the same app, served at /id/ so it starts in Indonesian.
// It reuses the English page's assets and data, one folder up.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const html = readFileSync("../docs/index.html", "utf8")
const id = html
  .replaceAll('="./assets/', '="../assets/')
  .replace('<html lang="en">', '<html lang="id">')
if (id === html || !id.includes('="../assets/')) throw new Error("asset paths not found in docs/index.html")
mkdirSync("../docs/id", { recursive: true })
writeFileSync("../docs/id/index.html", id)
console.log("wrote docs/id/index.html")
