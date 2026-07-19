# Use the Jira to Repo Workflow

Ender currently ships one built-in guided workflow: `jira_to_repo_task`.

It exists to turn a Jira issue into a live development thread with minimal manual setup.

## What the workflow does

The workflow gathers structured inputs, then starts a normal Ender task in the cloned repository.

Stages:

1. Select Jira project
2. Select Jira board
3. Select Jira issue
4. Clone the repository
5. Choose commit and push policy
6. Choose the final Jira transition behavior
7. Start the task

## Required configuration

Minimum Jira settings:

```env
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...
```

You also need a working LLM backend, since the workflow ultimately starts a normal task.

## Start the workflow

In the UI:

1. Choose **Workflows** in the primary navigation.
2. Choose `Jira -> Repo -> Work`.

Under the hood, the UI creates a session with:

- `POST /workflows/jira_to_repo_task/sessions`

## Step-by-step behavior

### Project selection

Ender loads Jira projects during session bootstrap. If that bootstrap fails, the session exposes a `bootstrapError`.

### Board selection

After you choose a project, Ender requests the boards for that project and the list of statuses that can later be used as issue filters.

### Issue selection

The issue step is a `select` step with a server-driven filter. When you apply a status filter, the workflow re-queries Jira for issues on the selected board.

### Repository clone

The repo step asks for:

- repository URL
- optional target directory

Ender clones into `AGENT_WORKDIR` by default.

### Commit and push policy

The selected delivery mode is baked into the task prompt:

- `no_commit`
- `commit_only`
- `commit_and_push`

Push still requires a UI approval when the task reaches that action.

### Final Jira behavior

You can either:

- leave the issue unchanged
- choose one of the available Jira transitions

### Task handoff

On the last step, the workflow starts a normal task with:

- the cloned repo path as the task workspace
- a generated goal prompt built from Jira issue data, delivery settings, and Jira outcome settings

## Going back

Workflow sessions support back navigation until a task has been started.

API:

- `POST /workflow-sessions/:id/back`

## Scheduling this workflow

The same workflow can also be used inside a schedule. In schedule mode, the workflow collects and stores its inputs but does not start a task during configuration time.

See:

- [Create a recurring schedule](schedules.md)
- [Create a custom workflow](../guides/custom-workflow.md)
- [Troubleshoot Ender](../guides/troubleshooting.md)
