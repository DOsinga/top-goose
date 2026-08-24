import { describe, expect, it } from 'vitest'
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
