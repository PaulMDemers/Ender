# Ender Release Readiness Matrix

This document records repeatable release-environment checks and the most recent local evidence. It separates deterministic smokes from checks that require a target operating system, signing identity, cloud service, provider credentials, or production data. Code and CI results remain the source of truth when this record becomes stale.

Start at [`docs/README.md`](docs/README.md) for the maintained knowledge path and use the [operator troubleshooting guide](docs/guides/troubleshooting.md) when a smoke or deployment check fails.

## Last validated environment

- Date: 2026-07-20
- Host: macOS on arm64 (`Darwin 25.5.0`)
- Node.js: `24.18.0`
- npm: `11.16.0`
- Docker: Engine `29.6.1`, Docker Desktop `4.82.0`, Linux arm64
- Electron: `41.2.1`
- electron-builder: `26.15.3`

## Matrix

| Surface | Local evidence | Status | Boundary not claimed |
| --- | --- | --- | --- |
| Browser UI | Production Vite build, built index/chunk fetches, and 58 Chromium tests | Verified on local Chromium | Safari, Firefox, mobile WebKit, and signed release hosting |
| Conversation and provider activity | Backend contract tests cover direct-provider structured events and ACP normalization; browser tests cover compact live work summaries, legacy event reconciliation, paired tool detail, and clean final responses | Verified deterministically | Live Azure, Ollama, and non-Codex ACP agents |
| Direct-local API | Real `src/server.js` process on an isolated loopback port; `/health`, API contract header, empty task collection, and graceful shutdown | Verified | Credential-backed model execution and external integrations |
| Concurrent ACP and OpenAI task execution | One isolated `src/server.js` process published both profiles, honored distinct `llmProfileId` selections, and completed authenticated deterministic-marker tasks through each backend | Verified with configured Codex and OpenAI accounts | Azure, Ollama, other ACP agents, alternate accounts/models, and production network policy |
| Bedrock model execution | Isolated `src/server.js` processes completed deterministic-marker tasks through the default Sonnet 5 profile and generated secondary Sonnet 4.6 profile | Verified with configured AWS account in `us-east-1` | Other regions/accounts, IAM/SCP policies, Azure/Ollama model variants, and production quotas |
| Pillar-connected API | Real legacy-mode `scripts/pillar-server.js`, real Ender outbound connector, relayed `/health`, contract header, connector status, and clean shutdown | Verified locally | OIDC/Keycloak, TLS ingress, shared Postgres, and a deployed cloud relay |
| Electron runtime | Built renderer loaded through Electron with sandboxing/context isolation; preload bridge and root verified; Content Security Policy active | Verified on macOS arm64 | Windows and Linux runtime behavior |
| Electron package | `electron-builder --dir` produced `ui/dist/mac-arm64/Ender UI.app`; packaged renderer/preload smoke passed | Verified, unsigned | Developer ID signing, notarization, DMG installation, Windows NSIS, and Linux AppImage |
| Docker configuration | `docker compose config --quiet` and service discovery | Verified | Deployment-specific secrets, firewall rules, and persistent-volume backup policy |
| Docker images | API and UI images built on Linux arm64; both dependency installs reported zero advisories | Verified | amd64 build execution in this host session |
| Docker runtime | API and nginx UI containers served `/health` and built HTML on loopback-only temporary ports, then stopped and auto-removed | Verified for core API/UI | Browser capture is unavailable in the production API image because Playwright is not installed; code-server launch was disabled for the isolated smoke |

## Repeatable checks

Run the complete deterministic repository gate:

```bash
npm run verify
```

The gate includes `npm run docs:check`, which validates local links across 68 maintained and historical Markdown files and validates referenced root npm scripts in maintained records.

Refresh documentation screenshots only after reviewing an intentional visual-baseline change:

```bash
npm run docs:screenshots:sync
```

The documentation copies are exact PNG copies of tested Playwright baselines; their source mapping is recorded in [`docs/website/visual-and-screenshot-plan.md`](docs/website/visual-and-screenshot-plan.md).

Run isolated production-entry checks for the direct API, built browser assets, and a real local Pillar relay:

```bash
npm run smoke:release:local
```

The smoke overrides connector and persistence variables, uses temporary directories and loopback ports, does not launch an LLM task, and removes its temporary state after shutdown.

Run the opt-in credential-backed Codex ACP server smoke:

```bash
npm run smoke:acp-server
```

This check starts `src/server.js` on an isolated loopback port, creates a task through the HTTP API, completes one minimal model turn, verifies a deterministic marker, and removes its temporary state. It uses the configured Codex login or API key and network access, so it is intentionally excluded from the deterministic repository gate.

Run the same-server ACP and OpenAI profile smoke:

```bash
npm run smoke:configured-backends
```

This verifies that one isolated server publishes both profiles and honors distinct `llmProfileId` selections for two minimal tasks. Like the ACP-only smoke, it makes real provider requests and is excluded from `npm run verify`.

Run the Bedrock profile against the same isolated real-server boundary:

```bash
npm run smoke:bedrock-server
```

This uses the configured AWS credentials, region, and `BEDROCK_MODEL_ID`; it is the release check for model lifecycle, access, and inference-profile errors that deterministic tests cannot reproduce.

Run the Electron renderer/preload smoke:

```bash
npm run smoke:electron
```

Build and verify the packaged app for the current host platform:

```bash
npm run electron:pack
npm run smoke:electron:packaged
```

Validate and build Docker images:

```bash
docker compose config --quiet
docker compose build
```

For an isolated runtime smoke, start the built images with explicit loopback-only port mappings and external connectors disabled. Do not use the repository `.env` for this check:

```bash
docker run --rm -d --name ender-release-api \
  -p 127.0.0.1:3300:3000 \
  -e ENDER_API_ACCESS_MODE=open \
  -e ENDER_API_BIND_HOST=0.0.0.0 \
  -e ENDER_CORS_ORIGINS=http://127.0.0.1:5273 \
  -e CODE_SERVER_ENABLED=false \
  -e LLM_BACKEND=acp \
  -e ACP_COMMAND= \
  -e AGENT_TASK_LEDGER_POLL_INTERVAL_MS=0 \
  -e PILLAR_ENABLED=false \
  -e BEACON_ENABLED=false \
  ender-api:latest

docker run --rm -d --name ender-release-ui \
  -p 127.0.0.1:5273:80 \
  ender-ui:latest

curl --fail http://127.0.0.1:3300/health
curl --fail http://127.0.0.1:5273/
docker stop ender-release-api ender-release-ui
```

Check both production and complete dependency graphs:

```bash
npm audit --omit=dev
npm audit
```

Both audits reported zero advisories at the last validation point. Advisory results are time-sensitive and must be rerun for each release candidate.

## Release safeguards established

- The UI now declares a Content Security Policy that blocks arbitrary script execution while retaining configurable HTTP/HTTPS/WebSocket backends, hosted fonts, image attachments, and embedded workspace editors.
- Electron is pinned to an exact packaging version and the workspace plus standalone UI lockfiles are synchronized.
- Electron smoke mode uses temporary user data, verifies the preload bridge and renderer root, emits one machine-readable success marker, and self-terminates.
- `concurrently` is development-only and is no longer copied into the production API dependency graph.
- Express, LangChain providers, IMAP, Nodemailer, and affected transitive packages were advanced to patched compatible versions; the full backend and browser matrix passed afterward.
- Docker build stages use clean `npm ci` installs and reported zero advisories for both API runtime dependencies and UI build dependencies.

## Remaining release-owner checks

- Run macOS signing, notarization, DMG installation, and launch on a clean user account.
- Run Windows NSIS and Linux AppImage packaging plus startup smoke on their native target systems.
- Decide whether Docker browser capture is a supported production capability; if yes, add a dedicated Playwright-enabled runtime layer and browser smoke.
- Exercise Docker-backed code-server launch with a disposable workspace and the intended Docker socket policy.
- Exercise OIDC Pillar registration and relay through the deployed TLS/Postgres environment.
- Run one credential-backed task for each provider profile intended for the release.
- Review firewall, reverse-proxy, CORS, volume backup, and secret-injection settings for the deployment target.
