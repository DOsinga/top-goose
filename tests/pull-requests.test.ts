import { describe, expect, it } from 'vitest'
import { groupReviewThreads, type RestReviewComment } from '../src/main/github/pullRequests'

function reviewComment(id: number, replyTo?: number): RestReviewComment {
  return {
    id,
    node_id: `node-${id}`,
    in_reply_to_id: replyTo,
    body: `comment ${id}`,
    user: { login: `person-${id}`, avatar_url: '' },
    created_at: `2026-01-01T00:00:0${id}Z`,
    updated_at: `2026-01-01T00:00:0${id}Z`,
    path: 'src/file.ts',
    line: 10,
    original_line: 10,
    diff_hunk: '@@ -1 +1 @@',
  }
}

describe('pull request review threads', () => {
  it('keeps replies with their root comment and carries GitHub resolution state', () => {
    const threads = groupReviewThreads(
      [reviewComment(1), reviewComment(2, 1), reviewComment(3)],
      new Map([
        [1, { id: 'thread-one', resolved: true }],
        [3, { id: 'thread-three', resolved: false }],
      ]),
    )

    expect(threads).toEqual([
      expect.objectContaining({
        id: 'thread-one',
        resolved: true,
        comments: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })],
      }),
      expect.objectContaining({
        id: 'thread-three',
        resolved: false,
        comments: [expect.objectContaining({ id: 3 })],
      }),
    ])
  })
})
