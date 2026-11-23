import type { Audit } from "@/lib/types"

/** Where the checking service lives. Empty means the same site (Vercel serves both). */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ""

export const PLATFORM_OPTIONS = ["", "shopify", "wordpress", "woocommerce", "wix", "squarespace"] as const

export type ScanResult = Audit & { cached: boolean }

export class ScanFailure extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function scanSite(url: string, platform: string, signal?: AbortSignal): Promise<ScanResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, platform }),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    throw new ScanFailure("network", "network")
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ScanFailure("network", "network")
  }
  if (!res.ok) {
    const e = body as { error?: string; message?: string }
    throw new ScanFailure(e.error ?? "failed", e.message ?? "failed")
  }
  return body as ScanResult
}

/** The host to show and put in the link: handworks.com.au from https://www.handworks.com.au/x */
export function hostOf(address: string): string {
  const text = address.trim()
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).host
  } catch {
    return text
  }
}
