import { API_BASE, ScanFailure } from "@/lib/scan"
import type { BusinessProfile, FixChoice, SiteView } from "@/lib/types"

async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<SiteView> {
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
    throw new ScanFailure(e.error ?? "failed", e.message ?? "failed")
  }
  return data as SiteView
}

/** Scan an address and open a page for it. Fails with code "storage_off" when pages are not switched on. */
export const createSite = (url: string, platform: string, signal?: AbortSignal) => call({ action: "create", url, platform }, signal)
export const getSite = (token: string, signal?: AbortSignal) => call({ action: "get", token }, signal)
export const rescanSite = (token: string) => call({ action: "rescan", token })
export const setFix = (token: string, check_id: string, state: FixChoice) => call({ action: "fix", token, check_id, state })
export const saveProfile = (token: string, profile: Record<string, string>) => call({ action: "profile", token, profile })
export const askNow = (token: string) => call({ action: "ask", token })
export type { BusinessProfile }
