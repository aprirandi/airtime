// Copies docs/data (what the daily shift and the audits write into the repository) into the Vercel build, so the
// overview, dashboard, agents and checks pages have their data on Vercel as well. Every audit and shift commit
// redeploys the site, so the data there is as fresh as the repository.
import { cpSync, existsSync, rmSync } from "node:fs"

const out = process.env.AIRTIME_OUT ?? "../docs"
const from = new URL("../../docs/data", import.meta.url)
const to = new URL(`../${out}/data`, import.meta.url)

if (!existsSync(from)) {
  console.warn("docs/data is not here: the overview, dashboard, agents and checks pages will have no data")
  process.exit(0)
}
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log(`copied docs/data to ${out}/data`)
