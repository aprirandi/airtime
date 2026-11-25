/**
 * Which platform a site runs on, read from its homepage, for a client who did not say. Only the two the Fixer has
 * packages for are recognised; anything else is "" (unknown), never a guess. WooCommerce sites are WordPress sites.
 */
export function detectPlatform(html: string): "wordpress" | "shopify" | "" {
  const page = html.slice(0, 400_000)
  if (/<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(page) || /\/wp-(?:content|includes)\//i.test(page)) return "wordpress"
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(page)) return "shopify"
  return ""
}
