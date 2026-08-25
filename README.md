# Top Goose

GitHub issues and pull requests as conversations, with a private [Goose](https://github.com/block/goose) side-channel attached to each one.

Issue triage usually means a browser tab per issue and no help from your agent. Top Goose turns a repository's issues into something closer to Slack:

- **Left — channels:** switch between every open issue and every open pull request. Each view has filters suited to it, including PRs older than seven days.
- **Center — the conversation:** issue discussion and triage controls, or PR metadata, checks, review summaries, inline review threads, general comments, and an Approve button.
- **Right — the goose:** a persistent private Goose conversation scoped to the selected issue or PR, running against your local clone. Goose receives the full public discussion as context and can use `gh` when asked.

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

Browse to your local clone; the GitHub repository is derived from its `origin` remote, and the sidebar scopes itself to that repository. The clone is what gives Goose code access. Leave **worktrees** on unless the sessions are strictly read-only: each session then runs in its own `issue-N` or `pr-N` worktree so parallel sessions can't trample each other or your checkout. Opening a PR never checks out or runs contributor code; Goose can check it out deliberately when asked.

Optionally pick a Projects V2 board plus its `Status` and snooze (date) fields — that lights up the status dropdown in the issue header, the status tags in the sidebar, and snoozing (snoozed issues sink to the bottom until their date passes). Per-repo instructions typed here are appended to every Goose session's system prompt.

## How it talks to GitHub

- Change detection polls `/notifications` with `If-None-Match`; an idle repository costs zero rate limit.
- Reconciliation fetches every open issue and pull request in the configured repository every 5 minutes to establish both sidebar sets.
- Hydration uses batched GraphQL queries over only the conversations that changed. Every query carries `rateLimit { cost remaining }`; below a floor of remaining points the app degrades to cached rows instead of querying.

## How it talks to Goose

One long-lived `goose acp` child process (newline-delimited JSON-RPC over stdio) multiplexes all sessions: one persistent session per issue or PR and GitHub account, resumed across restarts via `session/load`. GitHub context is injected as untrusted JSON data per turn. PR context includes general comments, review summaries, and inline review threads. Sessions run in `GOOSE_MODE=auto`; permission requests are approved automatically and tool calls are displayed after the fact. Worktrees isolate concurrent Git state; they are not a security sandbox.

The `draft_reply` tool Goose uses is served by an MCP endpoint inside the Electron main process (127.0.0.1, random port, per-launch token, per-conversation session paths). It is attached to sessions via `_goose/unstable/session/extensions/add` after a bare create/load — passing `mcpServers` inline replaces the session's whole extension list on goose ≤ 1.47 ([goose#11339](https://github.com/block/goose/pull/11339)), which would strip the developer extension. Drafts land in the selected conversation's reply composer for review.

## Development

```sh
npm run dev        # electron-vite; hot-restarts the main process when it changes
npm test           # focused state, replay, and context synchronization tests
npm run typecheck  # both the node and web tsconfigs
npm run build
```

Stack: Electron + electron-vite, React 19, TypeScript, Tailwind v4, zustand, `@modelcontextprotocol/sdk`.
