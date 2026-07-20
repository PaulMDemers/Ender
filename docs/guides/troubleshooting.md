# Troubleshoot Ender

Use this guide for operator and deployment problems. Start with the visible symptom, then use the UI diagnostics and the smallest matching command. For code-level investigation, continue into [`knowledge/troubleshooting.md`](../../knowledge/troubleshooting.md).

## First checks

1. Open **Server connections** and select **Check now**.
2. Read the connection state: **Idle**, **Checking**, **Connected**, or **Unavailable**.
3. Expand **Runtime capabilities**. This reports the server/UI versions, REST and stream contracts, direct API exposure, workspace root, active backend, and missing configuration for core and optional capabilities.
4. Fetch `http://localhost:3000/health` directly when using the default local API.
5. Check the API terminal before changing configuration.

The UI preserves the last successful health snapshot during an outage and labels it **last known snapshot**. Treat that snapshot as diagnostic context, not proof that the server is currently reachable.

## UI cannot connect

- Confirm the selected endpoint includes `http://` or `https://` and the correct port.
- For the standard development process, use `http://localhost:3000`; `npm run dev` serves the UI at `http://localhost:5173`.
- If the endpoint was previously reachable, use **Check now**, inspect the API terminal, and retry the same saved endpoint.
- A REST or stream contract warning means the server advertises a newer contract than the UI understands. Requests remain non-blocking for compatibility, but update the UI before relying on changed behavior.
- Direct network clients are rejected by the default `ENDER_API_ACCESS_MODE=local`. Use Pillar for authenticated remote access, or explicitly set `open` only behind a trusted deployment boundary with `ENDER_CORS_ORIGINS` configured.

## Server starts but is not ready

Read `services.llm` in `/health` or the **Runtime capabilities** cards.

- OpenAI requires `OPENAI_API_KEY` and a model selection. Additional models come from `OPENAI_MODELS`.
- Bedrock requires AWS credentials/region available to the SDK and an active model or inference-profile ID. Additional IDs come from `BEDROCK_MODEL_IDS`; use `npm run smoke:bedrock-server` after changing them.
- Azure requires its API key, instance/base path, deployment name, and API version. Additional deployments come from `AZURE_OPENAI_API_DEPLOYMENT_NAMES`.
- Ollama requires a reachable `OLLAMA_BASE_URL` and available model. Additional models come from `OLLAMA_MODELS`.
- ACP requires a real ACP-compliant command in `ACP_COMMAND`; the raw Codex CLI is not itself an ACP server. For Codex, use `ACP_COMMAND=npx` with `ACP_ARGS=--yes @agentclientprotocol/codex-acp`.

Jira, GitHub, browser capture, email, code-server, Pillar, Beacon, and self-update are optional capabilities. Their attention state does not make the core API unavailable. Configure only the capabilities required by the intended task.

## A task will not launch or stops immediately

- Keep the **Mission goal**, project, and workspace intact; the launch form exposes the server error and a **Try again** path.
- Open **Review run settings** to confirm the selected backend profile and memory mode.
- Confirm the workspace exists and is within the server's allowed workspace root.
- Check the LLM capability card for missing variables, then restart the API after changing `.env`.
- Inspect the selected thread's transcript for model authentication, tool initialization, approval, `stall_detected`, or step-limit output.
- A task in `awaiting_approval` is paused by design. Resolve the single approval surface before sending a follow-up.

If the transcript mentions deprecated `@zed-industries/codex-acp`, an unknown `max` reasoning variant, or a model that requires a newer Codex version:

1. Replace `ACP_ARGS` with `--yes @agentclientprotocol/codex-acp`.
2. Remove a stale `CODEX_PATH` override if one is configured.
3. Restart Ender so the subprocess configuration is reloaded.
4. Run `npm run smoke:acp-server` to verify an isolated server, HTTP task launch, ACP handshake/session, and one minimal model turn.

The ACP smoke uses the configured Codex login or API key and makes a real model request. Its temporary server state is isolated from the normal Ender workspace and removed after the run.

## Threads or automation do not refresh

- Use the visible retry action on the affected state notice.
- Background polling pauses while the document is hidden and refreshes immediately when it becomes visible again.
- Switching endpoints resets server-owned task, workflow, schedule, and ledger state; confirm the active server in the application header.
- If a record fails after a restart, inspect the API warning. Ender skips malformed or future-version records rather than overwriting them.

## Workflow or schedule fails

- **Workflows** shows missing prerequisites without hiding the workflow. Configure the listed service, then retry the failed start/advance/back operation.
- Jira workflow bootstrap requires Jira URL, email, and API token plus a working model backend for the final task.
- **Schedules** records its latest run status and message. Use **Run now** before waiting for the cron cadence.
- Check the five-field cron expression and IANA timezone.
- Workflow schedules replay saved inputs without operator interaction; a workflow that requires a new interactive choice cannot complete unattended.

## Task ledger work does not run

- Open **Task ledger** and inspect the entry outcome, attempt count, linked thread, and server capacity.
- Manual **Run now** is always explicit. Automatic dispatch also requires a positive `AGENT_TASK_LEDGER_MAX_AUTO_AGENTS` and available task capacity.
- The ledger poll interval is controlled by `AGENT_TASK_LEDGER_POLL_INTERVAL_MS`; `0` disables background dispatch polling.
- Docker deployments must persist `./task-ledger:/app/task-ledger` or ledger state will not survive container replacement.

## Editor is unavailable

- Expand the server's code-editor capability card before launching the editor.
- `CODE_SERVER_ENABLED=false` disables it intentionally.
- `CODE_SERVER_MODE=local` needs `code-server` or a compatible configured npx package. `docker` mode needs Docker, `CODE_SERVER_IMAGE`, a correct host-workspace mapping, and access to the Docker socket.
- The release matrix currently verifies the core API/UI Docker runtime, but not Docker-backed code-server launch. Treat that path as target validation until its smoke is added.

## Docker UI works but the API is exposed

The Compose profile intentionally sets `ENDER_API_ACCESS_MODE=open` because host-forwarded traffic is not loopback inside the API container. Its default browser allowlist is `http://localhost:5173`, but CORS is not authentication. Keep port `3000` on a trusted host/firewall boundary. Prefer Pillar for remote access.

Persist these directories: `threads`, `workspace`, `schedules`, `task-ledger`, and `workflow-sessions`. The Compose file already mounts them.

## Pillar remote access fails

- Check `GET /pillar/status` on the on-prem API.
- Confirm `PILLAR_ENABLED`, URL, server ID, and server token all refer to the same registered server.
- Production uses `PILLAR_AUTH_MODE=oidc`, TLS, and preferably Postgres. `legacy` mode is retained for local compatibility testing, not as the recommended internet-facing configuration.
- Confirm the Ender connector can make outbound requests to Pillar; the on-prem API does not need an inbound firewall opening.
- A local Pillar smoke is available through `npm run smoke:release:local`. Deployed OIDC/Postgres relay validation remains an environment-owner check in [`RELEASE_READINESS.md`](../../RELEASE_READINESS.md).

## Electron or packaged app fails

- Run `npm run smoke:electron` to validate the built renderer, sandboxed preload bridge, and Content Security Policy with the installed Electron runtime.
- Run `npm run electron:pack`, then `npm run smoke:electron:packaged` to exercise the current-platform unpacked app.
- Current local evidence is an unsigned macOS arm64 package. Signing, notarization, DMG installation, and Windows/Linux packages require their target environments.

## Verification commands

Use the narrowest useful gate first:

```bash
npm run docs:check
npm test
npm run typecheck
npm run build
npm run verify
```

`npm run verify` checks version synchronization, documentation links/scripts, backend tests, targeted typechecking, syntax, the production UI build, and the Playwright browser suite. Environment and packaging checks are listed separately in [`RELEASE_READINESS.md`](../../RELEASE_READINESS.md).
