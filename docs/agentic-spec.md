# Ender Agentic Runtime Spec (v0.1)

## Goal
Build an agentic system that accepts a user prompt, repeatedly reasons, invokes tools, and continues until solved.

## Inputs
- `goal`: user prompt string
- environment-configured LLM backend: `openai | bedrock | azure | ollama`

## Outputs
- task status transitions: `running -> done|error|canceled`
- streaming logs via SSE
- final answer must start with `DONE:`

## API Contract
- `GET /health`
- `GET /tasks`
- `POST /tasks` with `{ "goal": "..." }`
- `GET /tasks/:id`
- `GET /tasks/:id/logs?from=<n>`
- `GET /tasks/:id/stream` (SSE: `status`, `log`, `ping`)
- `DELETE /tasks/:id`
- `POST /tasks/:id/rerun`

This contract intentionally mirrors the previous server shape used by `agent-ui`.

## Runtime Model
1. Create chat model from backend config.
2. Bind tools to model.
3. Start message list with system prompt + user goal.
4. Loop until complete; if `AGENT_MAX_STEPS` is set, stop at that cap:
   - Invoke model.
   - If no tool calls, return model content.
   - Execute each tool call and append tool result as `ToolMessage`.
   - If any tool output starts with `DONE:`, stop.
5. Detect repeated tool-call cycles; stop as stalled when repetition exceeds `AGENT_STALL_LIMIT`.
6. If loop stops without `DONE:`, fallback-finalize with collected facts.

## Tooling (v0.1)
- Web: `http_get`, `news_search`
- Filesystem: `file_read`, `file_write`, `file_list`, `file_exists`
- Execution: `exec_run`
- Ledger/state: `save_fact`, `add_todo`, `get_ledgers`, `finalize`

All filesystem paths are jailed to `AGENT_WORKDIR`.

## Backend Providers
- OpenAI: API key + model
- AWS Bedrock: AWS credentials/region + model id
- Azure OpenAI: API key + deployment + instance/base-path + API version
- Ollama: base URL + local model name

## Build Phases
1. `v0.1` (this scaffold): single orchestrator loop, common tools, provider abstraction.
2. `v0.2`: explicit multi-agent delegation (`WebSurfer`, `FileSurfer`, `Coder`) and routing tool.
3. `v0.3`: persistence layer for tasks/results and resumable runs.
4. `v0.4`: hard cancel support with `AbortController` propagation into tools/model calls.
