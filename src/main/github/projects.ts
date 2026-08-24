import type { BoardConfig, ProjectField, ProjectSummary } from '../../shared/types'
import { graphql } from './client'

/**
 * Projects V2 reads/writes. These exist only in GraphQL; there is no REST
 * equivalent, which is why board state rides along in hydration and why
 * status/snooze edits go through updateProjectV2ItemFieldValue.
 */

// ---------- Board setup (settings UI) ----------

export async function listProjects(repo: string): Promise<ProjectSummary[]> {
  const [owner, name] = repo.split('/')
  type Result = {
    repository: {
      projectsV2: { nodes: { id: string; title: string; number: number }[] }
      owner: { projectsV2?: { nodes: { id: string; title: string; number: number }[] } }
    } | null
  }
  const data = await graphql<Result>(
    `query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        projectsV2(first: 20) { nodes { id title number } }
        owner {
          ... on Organization { projectsV2(first: 20) { nodes { id title number } } }
          ... on User { projectsV2(first: 20) { nodes { id title number } } }
        }
      }
    }`,
    { owner, name },
  )
  const repoProjects = data.repository?.projectsV2.nodes ?? []
  const ownerProjects = data.repository?.owner.projectsV2?.nodes ?? []
  const seen = new Set<string>()
  return [...repoProjects, ...ownerProjects].filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}

export async function listFields(projectId: string): Promise<ProjectField[]> {
  type Result = {
    node: {
      fields: {
        nodes: (
          | { __typename: 'ProjectV2SingleSelectField'; id: string; name: string; options: { id: string; name: string }[] }
          | { __typename: 'ProjectV2Field'; id: string; name: string; dataType: string }
          | { __typename: string }
        )[]
      }
    } | null
  }
  const data = await graphql<Result>(
    `query ($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              __typename
              ... on ProjectV2SingleSelectField { id name options { id name } }
              ... on ProjectV2Field { id name dataType }
            }
          }
        }
      }
    }`,
    { id: projectId },
  )
  const fields: ProjectField[] = []
  for (const node of data.node?.fields.nodes ?? []) {
    if (node.__typename === 'ProjectV2SingleSelectField' && 'options' in node) {
      fields.push({ id: node.id, name: node.name, dataType: 'SINGLE_SELECT', options: node.options })
    } else if (node.__typename === 'ProjectV2Field' && 'dataType' in node && node.dataType === 'DATE') {
      fields.push({ id: node.id, name: node.name, dataType: 'DATE' })
    }
  }
  return fields
}

// ---------- Item lookup ----------

export type BoardItem = {
  itemId: string
  status?: string
  snoozedUntil?: string
}

/** Find this issue's item on the configured board, if it is on it. */
export async function boardItemForIssue(board: BoardConfig, issueNodeId: string): Promise<BoardItem | null> {
  type Result = {
    node: {
      projectItems: null | {
        nodes: {
          id: string
          project: { id: string }
          fieldValues: {
            nodes: (
              | { __typename: 'ProjectV2ItemFieldSingleSelectValue'; name: string; field: { id: string } }
              | { __typename: 'ProjectV2ItemFieldDateValue'; date: string; field: { id: string } }
              | { __typename: string }
            )[]
          }
        }[]
      }
    } | null
  }
  const data = await graphql<Result>(
    `query ($id: ID!) {
      node(id: $id) {
        ... on Issue {
          projectItems(first: 10) {
            nodes {
              id
              project { id }
              fieldValues(first: 20) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { id } } }
                  ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { id } } }
                }
              }
            }
          }
        }
      }
    }`,
    { id: issueNodeId },
  )
  const item = data.node?.projectItems?.nodes?.find((n) => n.project.id === board.projectId)
  if (!item) return null
  return { itemId: item.id, ...extractBoardFields(board, item.fieldValues.nodes) }
}

export function extractBoardFields(
  board: BoardConfig,
  fieldValues: ({ __typename: string } & Record<string, unknown>)[],
): { status?: string; snoozedUntil?: string } {
  let status: string | undefined
  let snoozedUntil: string | undefined
  for (const fv of fieldValues) {
    const field = fv.field as { id?: string } | undefined
    if (fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && field?.id === board.statusFieldId) {
      status = fv.name as string
    } else if (fv.__typename === 'ProjectV2ItemFieldDateValue' && field?.id === board.snoozeFieldId) {
      snoozedUntil = fv.date as string
    }
  }
  return { status, snoozedUntil }
}

// ---------- Writes ----------

async function ensureBoardItem(board: BoardConfig, issueNodeId: string): Promise<string> {
  const existing = await boardItemForIssue(board, issueNodeId)
  if (existing) return existing.itemId
  type AddResult = { addProjectV2ItemById: { item: { id: string } } }
  const added = await graphql<AddResult>(
    `mutation ($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
    }`,
    { projectId: board.projectId, contentId: issueNodeId },
  )
  return added.addProjectV2ItemById.item.id
}

export async function setIssueStatus(board: BoardConfig, issueNodeId: string, status: string): Promise<void> {
  const optionId = board.statusOptions[status]
  if (!optionId) throw new Error(`unknown status "${status}"`)
  const itemId = await ensureBoardItem(board, issueNodeId)
  await graphql(
    `mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
      ) { projectV2Item { id } }
    }`,
    { projectId: board.projectId, itemId, fieldId: board.statusFieldId, optionId },
  )
}

export async function setIssueSnooze(board: BoardConfig, issueNodeId: string, date: string | null): Promise<void> {
  const itemId = await ensureBoardItem(board, issueNodeId)
  if (date === null) {
    await graphql(
      `mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
        clearProjectV2ItemFieldValue(
          input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }
        ) { projectV2Item { id } }
      }`,
      { projectId: board.projectId, itemId, fieldId: board.snoozeFieldId },
    )
    return
  }
  await graphql(
    `mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
      updateProjectV2ItemFieldValue(
        input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { date: $date } }
      ) { projectV2Item { id } }
    }`,
    { projectId: board.projectId, itemId, fieldId: board.snoozeFieldId, date },
  )
}
