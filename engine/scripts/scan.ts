// Run one audit from the command line: npx tsx scripts/scan.ts <url> [platform]. Prints the result as JSON.
import { runAudit } from "../src/audit"
import { httpFetcher } from "../src/http"

const [url, platform = ""] = process.argv.slice(2)
if (!url) {
  console.error("usage: scan.ts <url> [platform]")
  process.exit(2)
}
const started = Date.now()
try {
  const audit = await runAudit(httpFetcher(), { baseUrl: url, platform })
  console.log(JSON.stringify({ ...audit, took_ms: Date.now() - started }))
} catch (err) {
  console.log(JSON.stringify({ error: (err as Error).message }))
  process.exit(1)
}
