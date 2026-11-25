import { API_BASE, ScanFailure } from "@/lib/scan"
import type { BusinessProfile, FixChoice, SiteView } from "@/lib/types"

async function call<T = SiteView>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/site`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal })
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    throw new ScanFailure("network", "network")
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new ScanFailure("network", "network")
  }
  if (!res.ok) {
    const e = data as { error?: string; message?: string }
    throw new ScanFailure(e.error ?? "failed", e.message ?? "failed", data)
  }
  return data as T
}

/** Scan an address and open a page for it. Fails with code "storage_off" when pages are not switched on. */
export const createSite = (url: string, platform: string, signal?: AbortSignal) => call({ action: "create", url, platform }, signal)
export const getSite = (token: string, signal?: AbortSignal) => call({ action: "get", token }, signal)
export const rescanSite = (token: string) => call({ action: "rescan", token })
export const setFix = (token: string, check_id: string, state: FixChoice) => call({ action: "fix", token, check_id, state })
export const saveProfile = (token: string, profile: Record<string, string>) => call({ action: "profile", token, profile })
export const askStart = (token: string) => call<{ run: string; total: number }>({ action: "ask_start", token })
export const askStep = (token: string, run: string, i: number) => call<{ done: number; total: number; quota: boolean }>({ action: "ask_step", token, run, i })
export const askFinish = (token: string, run: string) => call({ action: "ask_finish", token, run })
export type { BusinessProfile }

export interface AskProgress {
  done: number
  total: number
}

/** Ask the questions one at a time, three at once, each in its own request, then put the answers together. */
export async function runAsk(token: string, onProgress: (p: AskProgress) => void): Promise<SiteView> {
  const { run, total } = await askStart(token)
  onProgress({ done: 0, total })
  let next = 0
  let answered = 0
  let quota = false
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < total && !quota) {
        const i = next++
        try {
          quota = (await askStep(token, run, i)).quota
        } catch {
          /* an unanswered question counts as not answered; the others go on */
        }
        onProgress({ done: ++answered, total })
      }
    })
  )
  return askFinish(token, run)
}
