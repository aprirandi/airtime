/**
 * Which platform a site runs on, read from its homepage, for a client who did not say. Only platforms with clear
 * marks in the page are recognised; anything else is "" (unknown), never a guess. WooCommerce sites are WordPress sites.
 */
export function detectPlatform(html: string): "wordpress" | "shopify" | "wix" | "squarespace" | "" {
  const page = html.slice(0, 400_000)
  if (/<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(page) || /\/wp-(?:content|includes)\//i.test(page)) return "wordpress"
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(page)) return "shopify"
  if (/<meta[^>]+name=["']generator["'][^>]+content=["']Wix\.com|static\.wixstatic\.com|static\.parastorage\.com/i.test(page)) return "wix"
  if (/<meta[^>]+name=["']generator["'][^>]+content=["']Squarespace|static1\.squarespace\.com|assets\.squarespace\.com/i.test(page)) return "squarespace"
  return ""
}
