function htmlAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2]
}

function decodeHtmlAttribute(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    quot: '"',
    '#39': "'",
    lt: '<',
    gt: '>',
  }
  return value.replace(/&(amp|quot|#39|lt|gt);/g, (entity, name: string) => entities[name] ?? entity)
}

export function githubImageFromHtml(html: string): { url: string; alt: string } | null {
  const tag = html.trim().match(/^<img\b([^>]*)\/?\s*>$/i)
  if (!tag) return null
  const rawUrl = htmlAttribute(tag[1], 'src')
  if (!rawUrl) return null

  const url = decodeHtmlAttribute(rawUrl)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const githubAttachment =
    parsed.protocol === 'https:' &&
    ((parsed.hostname === 'github.com' && parsed.pathname.startsWith('/user-attachments/')) ||
      parsed.hostname === 'user-images.githubusercontent.com' ||
      parsed.hostname.endsWith('.githubusercontent.com'))
  if (!githubAttachment) return null

  return {
    url,
    alt: decodeHtmlAttribute(htmlAttribute(tag[1], 'alt') ?? 'Screenshot'),
  }
}
