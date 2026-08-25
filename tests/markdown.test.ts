import { describe, expect, it } from 'vitest'
import { codexReviewPrompt, extractCodexReviewHeading, isCodexReviewer } from '../src/renderer/src/codexReview'
import { githubImageFromHtml } from '../src/renderer/src/githubImages'

describe('GitHub screenshot HTML', () => {
  it('extracts GitHub attachment images', () => {
    expect(
      githubImageFromHtml(
        '<img width="958" height="626" alt="Image" src="https://github.com/user-attachments/assets/890ba965-aced-4016-82e3-ff281c507743" />',
      ),
    ).toEqual({
      alt: 'Image',
      url: 'https://github.com/user-attachments/assets/890ba965-aced-4016-82e3-ff281c507743',
    })
  })

  it('accepts older GitHub-hosted uploads', () => {
    expect(
      githubImageFromHtml(
        "<img alt='Screenshot' src='https://user-images.githubusercontent.com/1/2.png'>",
      ),
    ).toEqual({
      alt: 'Screenshot',
      url: 'https://user-images.githubusercontent.com/1/2.png',
    })
  })

  it('does not enable arbitrary HTML images', () => {
    expect(githubImageFromHtml('<img alt="tracking" src="https://example.com/pixel.png">')).toBeNull()
    expect(githubImageFromHtml('<script>alert(1)</script>')).toBeNull()
  })
})

describe('Codex review headings', () => {
  it('extracts the priority and title from Codex badge markup', () => {
    expect(
      extractCodexReviewHeading(
        '**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Handle context windows of 10k tokens or less**\n\nThe explanation.',
      ),
    ).toEqual({
      priority: 'P2',
      title: 'Handle context windows of 10k tokens or less',
      body: '\nThe explanation.',
    })
  })

  it('also accepts the flattened badge markup', () => {
    expect(
      extractCodexReviewHeading(
        '**<sub><sub>**P1 Badge**</sub></sub>** **Preserve the context limit**\n\nThe explanation.',
      ),
    ).toEqual({
      priority: 'P1',
      title: 'Preserve the context limit',
      body: '\nThe explanation.',
    })
  })

  it('leaves ordinary Markdown alone', () => {
    expect(extractCodexReviewHeading('**P2** A normal bold paragraph')).toBeNull()
  })

  it('turns a finding into an actionable Goose prompt', () => {
    expect(
      codexReviewPrompt({
        priority: 'P2',
        title: 'Handle small context windows',
        body: '\nThe implementation assumes a larger window.\n',
      }),
    ).toBe(
      'Fix this Codex review finding:\n\n[P2] Handle small context windows\nThe implementation assumes a larger window.',
    )
  })

  it('offers the action only for the Codex bot account', () => {
    expect(isCodexReviewer('chatgpt-codex-connector[bot]')).toBe(true)
    expect(isCodexReviewer('chatgpt-codex-connector')).toBe(false)
    expect(isCodexReviewer('contributor')).toBe(false)
  })
})
