import type { IssueComment } from '../../shared/types'
import { fetchComments, fetchIssue } from '../github/issues'
import type { IssueSession } from '../store'

/**
 * Builds the GitHub context block for a Goose turn.
 *
 * Delta by default, full snapshot as the fallback: new comments are cheap to
 * express because comment IDs are monotonic; edits and deletions are not, so
 * any sign of them (comment count mismatch, or updated_at moving with no new
 * comments) means resending the whole thing.
 */

export const CONTEXT_OPEN = '<github-context>'
const CONTEXT_CLOSE = '</github-context>'

export type SyncResult = {
  /** null when nothing changed and no context needs sending */
  contextBlock: string | null
  cursors: Pick<
    IssueSession,
    'lastSyncedCommentId' | 'lastSyncedIssueUpdatedAt' | 'lastSyncedCommentCount' | 'lastSyncedBodyUpdatedAt'
  >
}

function commentXml(c: IssueComment): string {
  return `<comment author="${c.author}" at="${c.createdAt}">\n${c.body}\n</comment>`
}

export async function buildContext(session: IssueSession, isFirstTurn: boolean): Promise<SyncResult> {
  const issue = await fetchIssue(session.repo, session.issueNumber)

  const makeCursors = (lastCommentId: number | undefined, commentCount: number): SyncResult['cursors'] => ({
    lastSyncedCommentId: lastCommentId,
    lastSyncedIssueUpdatedAt: issue.updated_at,
    lastSyncedCommentCount: commentCount,
    lastSyncedBodyUpdatedAt: issue.updated_at,
  })

  const snapshot = async (): Promise<SyncResult> => {
    const comments = await fetchComments(session.repo, session.issueNumber)
    const conversation = comments.map(commentXml).join('\n\n')
    const header = isFirstTurn
      ? `We are discussing GitHub issue ${session.repo}#${session.issueNumber}.`
      : `Here is the complete current state of GitHub issue ${session.repo}#${session.issueNumber} ` +
        `(resent because something was edited or deleted since we last synchronized):`
    const block = [
      CONTEXT_OPEN,
      header,
      '',
      `The issue is:`,
      '',
      `<title>\n${issue.title}\n</title>`,
      '',
      `<state>${issue.state}</state>`,
      '',
      `<body author="${issue.user.login}">\n${issue.body ?? ''}\n</body>`,
      '',
      comments.length > 0 ? `The GitHub conversation so far is:\n\n<conversation>\n${conversation}\n</conversation>` : 'There are no comments yet.',
      CONTEXT_CLOSE,
    ].join('\n')
    const lastId = comments.length > 0 ? comments[comments.length - 1].id : session.lastSyncedCommentId
    return { contextBlock: block, cursors: makeCursors(lastId, comments.length) }
  }

  if (isFirstTurn) return snapshot()

  const newComments = await fetchComments(session.repo, session.issueNumber, session.lastSyncedCommentId)
  const expectedCount = (session.lastSyncedCommentCount ?? 0) + newComments.length

  // deletion shows up as a count mismatch; an edit (of body or an existing
  // comment) as updated_at moving with nothing else to account for it
  const countMismatch = issue.comments !== expectedCount
  const updatedWithoutNewComments =
    newComments.length === 0 && issue.updated_at !== session.lastSyncedIssueUpdatedAt
  if (countMismatch || updatedWithoutNewComments) return snapshot()

  if (newComments.length === 0) {
    return { contextBlock: null, cursors: makeCursors(session.lastSyncedCommentId, issue.comments) }
  }

  const block = [
    CONTEXT_OPEN,
    `Since we last discussed GitHub issue ${session.repo}#${session.issueNumber}, the following happened on GitHub:`,
    '',
    `<conversation-update>\n${newComments.map(commentXml).join('\n\n')}\n</conversation-update>`,
    CONTEXT_CLOSE,
  ].join('\n')
  return {
    contextBlock: block,
    cursors: makeCursors(newComments[newComments.length - 1].id, issue.comments),
  }
}
