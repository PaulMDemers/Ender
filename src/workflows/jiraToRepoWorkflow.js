const fs = require("node:fs/promises");
const path = require("node:path");
const { requestJira } = require("../tools/jiraTools");
const { cloneRepository } = require("../tools/gitTools");
const { createSafeJoin } = require("../utils/safePath");

function summarizeBody(body) {
  if (body == null) return null;
  if (typeof body === "string") return body.slice(0, 500);
  if (Array.isArray(body)) return { type: "array", length: body.length };
  if (typeof body === "object") {
    return {
      keys: Object.keys(body).slice(0, 20),
      errorMessages: [
        body.errorMessages,
        body.errors,
        body.message
      ].filter(Boolean)
    };
  }
  return body;
}

function pushDebug(session, entry) {
  session.state.debug = session.state.debug || [];
  session.state.debug.push({
    t: new Date().toISOString(),
    ...entry
  });
  if (session.state.debug.length > 50) {
    session.state.debug.splice(0, session.state.debug.length - 50);
  }
}

function formatIssueSummary(issue) {
  const key = issue.key || "UNKNOWN";
  const summary = issue.fields?.summary || issue.summary || "Untitled issue";
  return `${key} - ${summary}`;
}

function formatProjectSummary(project) {
  const key = project.key || project.id || "UNKNOWN";
  const name = project.name || "Untitled project";
  return `${key} - ${name}`;
}

function formatBoardSummary(board) {
  const name = board.name || "Untitled board";
  const type = board.type || "board";
  return `${name} (${type})`;
}

function quoteJqlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function defaultCloneDirectory(repoUrl, directoryInput) {
  const requested = String(directoryInput || "").trim();
  if (requested) return requested;

  const rawBase = path.basename(String(repoUrl || "").trim(), ".git").trim();
  return rawBase || "repo";
}

function buildCollisionErrorMessage(directory) {
  return `Target directory '${directory}' already exists and is not empty. Choose a new target directory or clear it first.`;
}

async function inspectCloneTarget(rootDir, directory) {
  const safeJoin = createSafeJoin(rootDir);
  const repoPath = safeJoin(directory);

  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: `Target path '${directory}' already exists and is not a directory.`
      };
    }

    const items = await fs.readdir(repoPath);
    return {
      ok: true,
      exists: true,
      empty: items.length === 0,
      repoPath
    };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return {
        ok: true,
        exists: false,
        empty: false,
        repoPath
      };
    }
    throw err;
  }
}

function buildUniqueCloneDirectory(directory, stamp, attempt = 0) {
  const parsed = path.parse(directory);
  const suffix = attempt === 0 ? stamp : `${stamp}-${attempt + 1}`;
  return path.join(parsed.dir, `${parsed.base}-${suffix}`);
}

async function resolveCloneTarget(rootDir, directory, options = {}) {
  const mode = String(options.mode || "interactive");
  const timestamp = String(options.timestamp || new Date().toISOString())
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const inspected = await inspectCloneTarget(rootDir, directory);
  if (!inspected.ok) return inspected;

  if (!inspected.exists || inspected.empty) {
    return {
      ok: true,
      directory,
      repoPath: inspected.repoPath,
      autoRenamed: false
    };
  }

  if (mode !== "scheduled_run") {
    return {
      ok: false,
      error: buildCollisionErrorMessage(directory)
    };
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidateDirectory = buildUniqueCloneDirectory(directory, timestamp, attempt);
    const candidate = await inspectCloneTarget(rootDir, candidateDirectory);
    if (!candidate.ok) return candidate;
    if (!candidate.exists) {
      return {
        ok: true,
        directory: candidateDirectory,
        repoPath: candidate.repoPath,
        autoRenamed: true,
        requestedDirectory: directory
      };
    }
  }

  return {
    ok: false,
    error: `Unable to find an available clone target derived from '${directory}'.`
  };
}

async function loadProjects(config) {
  const pathname = "rest/api/3/project/search?maxResults=100";
  const response = await requestJira(config.jira, pathname);
  if (!response.ok) {
    return {
      ok: false,
      error: response.body?.message || `Jira project request failed (${response.status})`,
      debug: { pathname, status: response.status, body: summarizeBody(response.body) }
    };
  }

  return {
    ok: true,
    items: Array.isArray(response.body?.values) ? response.body.values : [],
    debug: {
      pathname,
      status: response.status,
      total: Array.isArray(response.body?.values) ? response.body.values.length : 0,
      body: summarizeBody(response.body)
    }
  };
}

async function loadBoards(config, projectKeyOrId) {
  const params = new URLSearchParams();
  params.set("maxResults", "100");
  if (projectKeyOrId) params.set("projectKeyOrId", String(projectKeyOrId));

  const pathname = `rest/agile/1.0/board?${params.toString()}`;
  const response = await requestJira(config.jira, pathname);
  if (!response.ok) {
    return {
      ok: false,
      error: response.body?.message || `Jira board request failed (${response.status})`,
      debug: { pathname, status: response.status, body: summarizeBody(response.body) }
    };
  }

  return {
    ok: true,
    items: Array.isArray(response.body?.values) ? response.body.values : [],
    debug: {
      pathname,
      status: response.status,
      total: Array.isArray(response.body?.values) ? response.body.values.length : 0,
      body: summarizeBody(response.body)
    }
  };
}

async function loadProjectStatuses(config, projectKeyOrId) {
  const pathname = `rest/api/3/project/${encodeURIComponent(String(projectKeyOrId))}/statuses`;
  const response = await requestJira(config.jira, pathname);
  if (!response.ok) {
    return {
      ok: false,
      error: response.body?.message || `Jira project statuses request failed (${response.status})`,
      debug: { pathname, status: response.status, body: summarizeBody(response.body) }
    };
  }

  const statuses = [...new Set((Array.isArray(response.body) ? response.body : [])
    .flatMap((issueType) => Array.isArray(issueType.statuses) ? issueType.statuses : [])
    .map((status) => status?.name)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    items: statuses,
    debug: {
      pathname,
      status: response.status,
      total: statuses.length,
      body: summarizeBody(response.body)
    }
  };
}

async function loadBoardIssues(config, boardId, statusFilter) {
  const params = new URLSearchParams();
  params.set("startAt", "0");
  params.set("maxResults", "50");
  if (statusFilter && statusFilter !== "all") {
    params.set("jql", `status = ${quoteJqlString(statusFilter)}`);
  }

  const pathname = `rest/agile/1.0/board/${encodeURIComponent(String(boardId))}/issue?${params.toString()}`;
  const response = await requestJira(config.jira, pathname);

  if (!response.ok) {
    return {
      ok: false,
      error: response.body?.message || `Jira issue request failed (${response.status})`,
      debug: { pathname, status: response.status, body: summarizeBody(response.body) }
    };
  }

  return {
    ok: true,
    items: Array.isArray(response.body?.issues) ? response.body.issues : [],
    debug: {
      pathname,
      status: response.status,
      total: Array.isArray(response.body?.issues) ? response.body.issues.length : 0,
      body: summarizeBody(response.body)
    }
  };
}

async function loadIssueTransitions(config, issueKey) {
  const pathname = `rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
  const response = await requestJira(config.jira, pathname);
  if (!response.ok) {
    return {
      ok: false,
      error: response.body?.message || `Jira transitions request failed (${response.status})`,
      debug: { pathname, status: response.status, body: summarizeBody(response.body) }
    };
  }

  return {
    ok: true,
    items: Array.isArray(response.body?.transitions) ? response.body.transitions : [],
    debug: {
      pathname,
      status: response.status,
      total: Array.isArray(response.body?.transitions) ? response.body.transitions.length : 0,
      body: summarizeBody(response.body)
    }
  };
}

function buildTaskPrompt(issue, repoPath, delivery, jiraOutcome) {
  const key = issue.key || "UNKNOWN";
  const summary = issue.fields?.summary || "No summary";
  const description = typeof issue.fields?.description === "string"
    ? issue.fields.description
    : JSON.stringify(issue.fields?.description || "");
  const mode = delivery?.mode || "no_commit";
  const deliveryInstruction = mode === "commit_and_push"
    ? "You may commit with a message prefixed by [Ender]. You may push only after the UI approval prompt is granted."
    : mode === "commit_only"
      ? "You may commit locally with a message prefixed by [Ender], but do not push."
      : "Do not commit or push changes unless the user explicitly changes the workflow settings.";
  const jiraOutcomeInstruction = jiraOutcome?.mode === "transition" && jiraOutcome.transitionId
    ? `When the work is done, transition Jira issue ${key} using jira_transition_issue with transition "${jiraOutcome.transitionId}" (${jiraOutcome.transitionName || "selected transition"}).`
    : "Do not change the Jira issue status unless the user explicitly changes the workflow settings.";

  return [
    `Work on Jira issue ${key}: ${summary}.`,
    `The repository for this task is cloned at ${repoPath}.`,
    "Review the issue details, inspect the codebase, implement the required changes, and summarize the result.",
    deliveryInstruction,
    jiraOutcomeInstruction,
    "If you comment on the Jira issue, post exactly one final Jira comment once the work is done.",
    "Do not post intermediate progress updates, debugging notes, or tool failures to Jira.",
    "If tools fail or you hit blockers, keep those details in the Ender thread only.",
    "Any Jira comment or commit message must start with [Ender].",
    description ? `Issue description/context: ${description.slice(0, 4000)}` : ""
  ].filter(Boolean).join("\n\n");
}

function getCurrentStep(session) {
  const stage = session.state.stage || "project";

  if (stage === "project") {
    return {
      id: "project",
      type: "select",
      title: "Select Jira project",
      description: "Choose the Jira project to work from.",
      options: (session.state.projects || []).map((project) => ({
        value: project.key || project.id,
        label: formatProjectSummary(project),
        description: project.projectTypeKey || ""
      }))
    };
  }

  if (stage === "board") {
    return {
      id: "board",
      type: "select",
      title: "Select Jira board",
      description: "Choose the board to load issues from.",
      options: (session.state.boards || []).map((board) => ({
        value: String(board.id),
        label: formatBoardSummary(board),
        description: board.location?.displayName || ""
      }))
    };
  }

  if (stage === "issue") {
    return {
      id: "issue",
      type: "select",
      title: "Select Jira item",
      description: "Pick the issue you want to work on.",
      filters: [
        {
          id: "status",
          type: "select",
          label: "Status",
          mode: "server",
          applyAction: "filter",
          applyLabel: "Apply",
          value: session.state.issueFilter?.status || "all",
          options: [
            { value: "all", label: "All statuses" },
            ...((session.state.projectStatuses || []).map((status) => ({
              value: status,
              label: status
            })))
          ]
        }
      ],
      options: (session.state.issues || []).map((issue) => ({
        value: issue.key,
        label: formatIssueSummary(issue),
        description: issue.fields?.status?.name || "",
        meta: {
          status: issue.fields?.status?.name || ""
        }
      }))
    };
  }

  if (stage === "repo") {
    return {
      id: "repo",
      type: "form",
      title: "Clone repository",
      description: "Provide the repository to clone before starting the task.",
      fields: [
        { id: "repoUrl", label: "Repository URL", type: "text", required: true, placeholder: "https://github.com/org/repo.git" },
        { id: "directory", label: "Target directory", type: "text", required: false, placeholder: "repo-folder" }
      ]
    };
  }

  if (stage === "delivery") {
    return {
      id: "delivery",
      type: "form",
      title: "Commit and push policy",
      description: "Tell Ender whether it should commit and/or push after finishing the work.",
      fields: [
        {
          id: "mode",
          label: "Delivery mode",
          type: "select",
          required: true,
          options: [
            { value: "no_commit", label: "Do not commit or push" },
            { value: "commit_only", label: "Commit locally only" },
            { value: "commit_and_push", label: "Commit and ask to push" }
          ]
        }
      ]
    };
  }

  if (stage === "jira_outcome") {
    return {
      id: "jira_outcome",
      type: "form",
      title: "Jira action when done",
      description: "Choose what Ender should do with the Jira item once the work is complete.",
      fields: [
        {
          id: "transitionId",
          label: "Final Jira status",
          type: "select",
          required: true,
          options: [
            { value: "leave_unchanged", label: "Leave issue status unchanged" },
            ...((session.state.issueTransitions || []).map((transition) => ({
              value: String(transition.id),
              label: transition.to?.name || transition.name || `Transition ${transition.id}`
            })))
          ]
        }
      ]
    };
  }

  return {
    id: "complete",
    type: "complete",
    title: "Workflow complete",
    description: session.state.startedTaskId
      ? `Started task ${session.state.startedTaskId}`
      : "Workflow complete"
  };
}

async function advance(session, input, { config, taskManager, cloneRepositoryImpl } = {}) {
  const stage = session.state.stage || "project";

  if (stage === "project") {
    const projectKey = String(input.value || input.projectKey || "").trim();
    const selected = (session.state.projects || []).find((project) => String(project.key || project.id) === projectKey);
    if (!selected) {
      return { ok: false, error: "Select a Jira project to continue" };
    }

    const boardResult = await loadBoards(config, projectKey);
    pushDebug(session, {
      step: "loadBoards",
      projectKey,
      ...boardResult.debug
    });
    if (!boardResult.ok) {
      return { ok: false, error: boardResult.error };
    }

    const statusResult = await loadProjectStatuses(config, projectKey);
    pushDebug(session, {
      step: "loadProjectStatuses",
      projectKey,
      ...statusResult.debug
    });
    if (!statusResult.ok) {
      return { ok: false, error: statusResult.error };
    }

    session.state.project = selected;
    session.state.boards = boardResult.items;
    session.state.projectStatuses = statusResult.items;
    session.state.stage = "board";
    return { ok: true };
  }

  if (stage === "board") {
    const boardId = String(input.value || input.boardId || "").trim();
    const selected = (session.state.boards || []).find((board) => String(board.id) === boardId);
    if (!selected) {
      return { ok: false, error: "Select a Jira board to continue" };
    }

    const issuesResult = await loadBoardIssues(config, boardId, "all");
    pushDebug(session, {
      step: "loadBoardIssues",
      boardId,
      statusFilter: "all",
      ...issuesResult.debug
    });
    if (!issuesResult.ok) {
      return { ok: false, error: issuesResult.error };
    }

    session.state.board = selected;
    session.state.issues = issuesResult.items;
    session.state.issueFilter = { status: "all" };
    session.state.stage = "issue";
    return { ok: true };
  }

  if (stage === "issue") {
    if (input.action === "filter") {
      const statusFilter = String(input.filters?.status || input.status || "all").trim() || "all";
      const boardId = session.state.board?.id;
      if (!boardId) {
        return { ok: false, error: "Board context missing for issue filter" };
      }

      const issuesResult = await loadBoardIssues(config, boardId, statusFilter);
      pushDebug(session, {
        step: "loadBoardIssues",
        boardId: String(boardId),
        statusFilter,
        ...issuesResult.debug
      });
      if (!issuesResult.ok) {
        return { ok: false, error: issuesResult.error };
      }

      session.state.issues = issuesResult.items;
      session.state.issueFilter = { status: statusFilter };
      return { ok: true };
    }

    const issueKey = String(input.value || input.issueKey || "").trim();
    const selected = (session.state.issues || []).find((issue) => issue.key === issueKey);
    if (!selected) {
      return { ok: false, error: "Select a Jira issue to continue" };
    }

    const response = await requestJira(
      config.jira,
      `rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description,status`
    );
    pushDebug(session, {
      step: "loadIssue",
      issueKey,
      pathname: `rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description,status`,
      status: response.status,
      body: summarizeBody(response.body)
    });

    if (!response.ok) {
      return { ok: false, error: response.body?.message || `Unable to load issue ${issueKey}` };
    }

    const transitionsResult = await loadIssueTransitions(config, issueKey);
    pushDebug(session, {
      step: "loadIssueTransitions",
      issueKey,
      ...transitionsResult.debug
    });
    if (!transitionsResult.ok) {
      return { ok: false, error: transitionsResult.error };
    }

    session.state.issue = response.body;
    session.state.issueTransitions = transitionsResult.items;
    session.state.stage = "repo";
    return { ok: true };
  }

  if (stage === "repo") {
    const repoUrl = String(input.repoUrl || "").trim();
    if (!repoUrl) {
      return { ok: false, error: "Repository URL is required" };
    }

    const directory = defaultCloneDirectory(repoUrl, input.directory);
    const safeJoin = createSafeJoin(config.workdir);
    const previewRepoPath = safeJoin(directory);

    if (session.mode === "schedule_config") {
      session.state.repo = {
        repoUrl,
        directory,
        repoPath: previewRepoPath,
        deferredClone: true
      };
      pushDebug(session, {
        step: "cloneRepoDeferred",
        repoUrl,
        directory,
        mode: session.mode
      });
      session.state.stage = "delivery";
      return { ok: true };
    }

    const cloneTarget = await resolveCloneTarget(config.workdir, directory, { mode: session.mode });
    pushDebug(session, {
      step: "resolveCloneTarget",
      repoUrl,
      directory,
      mode: session.mode || "interactive",
      ok: cloneTarget.ok,
      autoRenamed: cloneTarget.autoRenamed || false,
      resolvedDirectory: cloneTarget.directory || null,
      error: cloneTarget.error || null
    });
    if (!cloneTarget.ok) {
      return { ok: false, error: cloneTarget.error };
    }

    const cloneRepo = cloneRepositoryImpl || cloneRepository;
    const cloneResult = await cloneRepo({
      rootDir: config.workdir,
      repoUrl,
      directory: cloneTarget.directory,
      githubConfig: config.github
    });
    pushDebug(session, {
      step: "cloneRepo",
      repoUrl,
      directory: cloneTarget.directory,
      ok: cloneResult.ok,
      code: cloneResult.code,
      autoRenamed: cloneTarget.autoRenamed || false,
      requestedDirectory: cloneTarget.requestedDirectory || directory,
      stderr: cloneResult.stderr ? String(cloneResult.stderr).slice(0, 500) : ""
    });
    if (!cloneResult.ok) {
      return { ok: false, error: cloneResult.stderr || "Clone failed" };
    }

    const repoPath = cloneTarget.repoPath;
    session.state.repo = {
      repoUrl,
      directory: cloneTarget.directory,
      requestedDirectory: directory,
      repoPath,
      autoRenamed: cloneTarget.autoRenamed || false
    };
    session.state.stage = "delivery";
    return { ok: true };
  }

  if (stage === "delivery") {
    const mode = String(input.mode || "").trim();
    if (!["no_commit", "commit_only", "commit_and_push"].includes(mode)) {
      return { ok: false, error: "Select how Ender should handle commit and push" };
    }

    const repoPath = session.state.repo?.repoPath;
    if (!repoPath) {
      return { ok: false, error: "Repository context missing for delivery step" };
    }

    session.state.delivery = { mode };
    session.state.stage = "jira_outcome";
    return { ok: true };
  }

  if (stage === "jira_outcome") {
    const selectedTransitionId = String(input.transitionId || "").trim();
    if (!selectedTransitionId) {
      return { ok: false, error: "Select what Ender should do with the Jira item when work is done" };
    }

    const repoPath = session.state.repo?.repoPath;
    if (!repoPath) {
      return { ok: false, error: "Repository context missing for Jira outcome step" };
    }

    const selectedTransition = selectedTransitionId === "leave_unchanged"
      ? null
      : (session.state.issueTransitions || []).find((transition) => String(transition.id) === selectedTransitionId);

    if (selectedTransitionId !== "leave_unchanged" && !selectedTransition) {
      return { ok: false, error: "Select a valid Jira transition to continue" };
    }

    const jiraOutcome = selectedTransition
      ? {
          mode: "transition",
          transitionId: String(selectedTransition.id),
          transitionName: selectedTransition.to?.name || selectedTransition.name || String(selectedTransition.id)
        }
      : { mode: "leave_unchanged" };

    const taskPrompt = buildTaskPrompt(session.state.issue || {}, repoPath, session.state.delivery || {}, jiraOutcome);
    if (session.mode === "schedule_config") {
      session.state.jiraOutcome = jiraOutcome;
      session.state.scheduledTaskPreview = {
        workspace: repoPath,
        promptPreview: taskPrompt.slice(0, 400)
      };
      session.state.stage = "complete";
      session.status = "completed";
      return { ok: true };
    }

    const started = taskManager.start(taskPrompt, repoPath);
    if (!started.ok) {
      return { ok: false, error: started.message || started.error || "Unable to start task" };
    }

    session.state.jiraOutcome = jiraOutcome;
    session.state.startedTaskId = started.id;
    session.state.stage = "complete";
    session.status = "completed";
    return { ok: true, startedTaskId: started.id };
  }

  return { ok: false, error: "Workflow is already complete" };
}

const jiraToRepoWorkflow = {
  id: "jira_to_repo_task",
  name: "Jira -> Repo -> Work",
  description: "Pull Jira issues, pick one, clone the repository, and start a task.",
  supportsScheduling: true,
  async createInitialState(_input, { config }) {
    const projectResult = await loadProjects(config);
    const state = {
      stage: "project",
      projects: projectResult.ok ? projectResult.items : [],
      debug: [
        {
          t: new Date().toISOString(),
          step: "loadProjects",
          ...(projectResult.debug || {})
        }
      ]
    };
    if (!projectResult.ok) {
      state.bootstrapError = projectResult.error;
      return state;
    }

    return state;
  },
  getCurrentStep,
  advance
};

module.exports = {
  jiraToRepoWorkflow,
  advance,
  resolveCloneTarget,
  defaultCloneDirectory,
  buildCollisionErrorMessage
};
