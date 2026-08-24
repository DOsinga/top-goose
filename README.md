# Top Goose

GitHub issues as chat conversations, with a private [Goose](https://github.com/block/goose) side-channel attached to every issue.

Issue triage usually means a browser tab per issue and no help from your agent. Top Goose turns a repository's issues into something closer to Slack:

- **Left — channels:** issues involving you, sorted by activity, with unread counts, board status, and filter pills (`unread` / `unreplied` / `assigned`).
- **Center — the conversation:** the GitHub discussion, a reply composer, and in-place editing of the Projects V2 `Status` and snooze date.
- **Right — the goose:** a private Goose conversation scoped to the current issue, running against your local clone. Nothing there touches GitHub unless *you* press send: when Goose drafts a reply it lands in your composer for review, never on the issue.

See [DESIGN.md](DESIGN.md) for the full design.

## Requirements

- macOS (developed and tested there; nothing is intentionally platform-specific)
- Node.js 20+
- A [goose](https://block.github.io/goose/) binary ≥ 1.41 with a configured provider — Goose Desktop's bundled CLI, `brew install block-goose-cli`, or the install script. Run `goose configure` once if you haven't.
- A GitHub account with a classic personal access token (see below)

## Setup

```sh
git clone https://github.com/DOsinga/top-goose.git
cd top-goose
npm install
npm run dev
```

Settings open automatically on first run. Three steps:

### 1. Sign in to GitHub

Paste a classic personal access token with the `repo`, `project`, and `notifications` scopes. Tokens missing `repo` or `project` are rejected with instructions — `project` (not just `read:project`) is required because changing board Status/snooze writes to Projects V2.

If you use the GitHub CLI, the quickest route is:

```sh
gh auth refresh -s project && gh auth token
```

The token is stored encrypted (Electron `safeStorage`) in the app's user data, never in the repo.

### 2. Point it at goose

Top Goose auto-discovers goose (Goose Desktop bundle, Homebrew, `~/.local/bin`, `PATH`); you only need the override field if you keep a binary somewhere unusual. On macOS, prefer the Goose Desktop bundle CLI — it is Developer ID signed, so keychain approvals for your provider keys stick. Ad-hoc/self-built binaries re-prompt the keychain on every rebuild.

### 3. Choose the repository's local clone

Browse to your local clone; the GitHub repository is derived from its `origin` remote, and the sidebar scopes itself to that repository. The clone is what gives Goose code access. Leave **worktrees** on unless the sessions are strictly read-only: each issue's session then runs in its own git worktree (`<clone>-worktrees/issue-N`, branch `top-goose/issue-N`) so parallel sessions can't trample each other or your checkout.

Optionally pick a Projects V2 board plus its `Status` and snooze (date) fields — that lights up the status dropdown in the issue header, the status tags in the sidebar, and snoozing (snoozed issues sink to the bottom until their date passes). Per-repo instructions typed here are appended to every Goose session's system prompt.

## How it talks to GitHub

- Change detection polls `/notifications` with `If-None-Match`; an idle repository costs zero rate limit.
- Reconciliation runs a GraphQL search (`involves:@me` in the configured repo) every 5 minutes to establish the sidebar set.
- Hydration is one batched GraphQL query over only the issues that changed. Every query carries `rateLimit { cost remaining }`; below a floor of remaining points the app degrades to cached rows instead of querying.

## How it talks to Goose

One long-lived `goose acp` child process (newline-delimited JSON-RPC over stdio) multiplexes all sessions: one persistent session per issue, keyed on the issue node ID and resumed across restarts via `session/load`. GitHub context (issue body, new comments) is injected as delta blocks per turn, with a full-snapshot fallback when edits or deletions are detected. Sessions run in `GOOSE_MODE=auto`; isolation comes from the worktrees, not from approval prompts.

The `draft_reply` tool Goose uses is served by an MCP endpoint inside the Electron main process (127.0.0.1, random port, per-launch token, per-issue session paths). It is attached to sessions via `_goose/unstable/session/extensions/add` after a bare create/load — passing `mcpServers` inline replaces the session's whole extension list on goose ≤ 1.47 ([goose#11339](https://github.com/block/goose/pull/11339)), which would strip the developer extension. Drafts land in the reply composer: replacing it when it's untouched, offered as *Insert / Discard* when you've typed, and queued on the issue's sidebar row when the issue isn't open.

## Development

```sh
npm run dev        # electron-vite; add --watch to hot-restart the main process too
npm run typecheck  # both the node and web tsconfigs
npm run build
```

Stack: Electron + electron-vite, React 19, TypeScript, Tailwind v4, zustand, `@modelcontextprotocol/sdk`.
