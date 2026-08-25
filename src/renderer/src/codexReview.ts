export type CodexReviewHeading = {
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  title: string
  body: string
}

const headings = [
  /^\*\*<sub><sub>!\[(P[0-3]) Badge\]\(https:\/\/img\.shields\.io\/badge\/P[0-3]-[^)\s]+\)<\/sub><\/sub>[ \t]+([^\r\n]+?)\*\*[ \t]*(?:\r?\n|$)/,
  /^\*\*<sub><sub>\*\*(P[0-3]) Badge\*\*<\/sub><\/sub>\*\*[ \t]+\*\*([^\r\n]+?)\*\*[ \t]*(?:\r?\n|$)/,
]

export function extractCodexReviewHeading(markdown: string): CodexReviewHeading | null {
  const match = headings.map((heading) => heading.exec(markdown)).find((result) => result !== null)
  if (!match) return null
  return {
    priority: match[1] as CodexReviewHeading['priority'],
    title: match[2],
    body: markdown.slice(match[0].length),
  }
}

export function codexReviewPrompt(heading: CodexReviewHeading): string {
  return [
    'Fix this Codex review finding:',
    '',
    `[${heading.priority}] ${heading.title}`,
    heading.body.trim(),
  ]
    .filter((part, index) => part || index === 1)
    .join('\n')
}

export function isCodexReviewer(author: string): boolean {
  return author.toLowerCase() === 'chatgpt-codex-connector[bot]'
}
