# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-05-14

### Added

- **ACP Backend Support** — Ender can now use external ACP (Agent Client Protocol) compliant agents as the LLM backend. This allows agents like Claude Code to run as subprocesses, with Ender handling tool execution, approvals, logging, and persistence. The agent's permission requests (file read/write, shell commands) are routed through Ender's existing tool layer and approval system.
  - New env vars: `ACP_COMMAND` (agent binary) and `ACP_ARGS` (CLI args, defaults to `acp`)
  - New `LLM_BACKEND=acp` option alongside existing openai/bedrock/azure/ollama
  - ACP backends support LLM profiles for different agent binaries or configurations
  - Added `@agentclientprotocol/sdk` dependency

### Changed

- **README.md** — Updated feature list to mention ACP-compliant agents; added dedicated ACP configuration section with env var docs and example `.env` snippet.
- **README.md** — LLM backends list now explicitly includes "ACP-compliant agents (Claude Code, etc.)"

### Internal

- `src/config.js` — `LLM_BACKEND` enum extended with `acp`; added `ACP_COMMAND`/`ACP_ARGS` schema fields and `acp` config namespace with `command` and `args` fields.
- `src/llm/factory.js` — Added `acp` validation to `validateConfig()`; non-openai/non-azure backends fall through to `AzureChatOpenAI` when not matched, so no new model factory branch was needed.
- `src/llm/profileManager.js` — Added `acp` to `BACKEND_VALUES`; `normalizeProfile()` now handles `acp` backend config; `buildRunConfig()` now merges `acp` credentials.
- `src/runtime/runTask.js` — `runTask()` now branches on `config.backend === "acp"` before the LangChain path. When ACP is active, it calls `runAcpAgent()` from the new `acpAgentRunner` module and returns early. The `createChatModel()` call is gated behind the non-ACP branch to avoid trying to instantiate a LangChain chat model for ACP.
- **`src/llm/acpAgentRunner.js`** — New module. Implements the ACP subprocess runner:
  - Spawns the configured agent binary as a subprocess with stdio pipes
  - Sets up NDJSON stream transport using `acp.ndJsonStream()`
  - Instantiates `ClientSideConnection` with handlers for `sessionUpdate` (streaming text/chunks), `requestPermission` (maps ACP capabilities to Ender tools, delegates approvals), `readTextFile`, and `writeTextFile`
  - Calls `client.initialize()`, `client.newSession()`, and `client.prompt()` to run a task
  - Returns `{ result, stopReason }` compatible with the existing task result shape
- **`raw/` and `wiki/` directories** — Karpathy LLM wiki initialised with source material and compiled articles covering Ender project overview, runtime loop, workflows/schedules, self-update architecture, and UI operator console.