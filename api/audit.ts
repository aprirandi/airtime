// Vercel function: GET or POST /api/audit with the website address (and optionally the platform).
// All the work is in engine/src; see engine/src/api.ts for the rules.
import handler from "../engine/src/node"

export default handler
