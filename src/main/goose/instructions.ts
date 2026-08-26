import type { ConversationKind, Settings } from '../../shared/types'

export const FINISH_THE_TURN =
  'Complete the user request before ending your turn. Do not say that you will continue, keep going, or do more work later and then end the turn. If more work can be done without user input, do it now. End only when the request is complete or you need specific input from the user.'

export function sessionInstructions(settings: Settings, kind: ConversationKind): string {
  const conversationInstructions =
    kind === 'pullRequest' ? settings.pullRequestInstructions : settings.issueInstructions
  return [FINISH_THE_TURN, conversationInstructions]
    .filter((part): part is string => !!part?.trim())
    .join('\n\n')
}
