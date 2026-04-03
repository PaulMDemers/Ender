# Ender Website Rebuild Deliverables

This document lists the content artifacts that need to exist in order for another LLM or implementation agent to rebuild `ender.bot` accurately and with minimal guesswork.

It is intentionally explicit. The goal is to reduce assumptions during implementation.

## Purpose

The new Ender site should reflect the current reality of the product:

- Ender is a local-first agent runtime.
- Ender is an operator-facing control surface for supervised agent work.
- Ender has a real tool ecosystem, not just prompt orchestration.
- Ender supports guided workflows, recurring schedules, persistent threads, and approval-gated actions.
- Ender is available through a browser UI, Electron desktop app, and local API.

## Deliverables to Write and Maintain

### 1. Master site specification

File:
- `docs/website/new-site-spec.md`

Purpose:
- Define the full positioning, information architecture, messaging rules, page requirements, and acceptance criteria for the rebuilt site.

Status:
- Complete

### 2. Homepage copy deck

File:
- `docs/website/homepage-copy.md`

Purpose:
- Provide implementation-ready copy for the homepage, including hero, proof points, capability sections, tool ecosystem summary, workflow section, automation section, safety section, deployment section, and CTAs.

Why it is needed:
- The site builder should not have to infer homepage messaging from the master spec.

### 3. Product page copy deck

File:
- `docs/website/product-page-copy.md`

Purpose:
- Explain Ender as a product/platform in implementation-ready copy.
- Cover runtime model, operator console, persistence, workflows, schedules, desktop app, API, and deployment.

### 4. Tools overview and category page copy deck

File:
- `docs/website/tools-pages-copy.md`

Purpose:
- Provide a tools overview page plus detailed copy requirements for each tool category page.
- Ensure the site explicitly communicates Ender’s tool breadth.

Required categories:
- Workspace & Files
- Shell & Local Execution
- Web & Browser
- Git & Repositories
- GitHub & GitLab
- Jira & Knowledge Systems
- Email & Communication
- Scheduling & Delegation
- Self-Update

### 5. Workflows page copy deck

File:
- `docs/website/workflows-page-copy.md`

Purpose:
- Explain Ender’s workflow model, current built-in workflow, workflow modes, and extensibility.

### 6. Automation page copy deck

File:
- `docs/website/automation-page-copy.md`

Purpose:
- Explain schedules, target kinds, persistence, cron behavior, and operator visibility.

### 7. Safety page copy deck

File:
- `docs/website/safety-page-copy.md`

Purpose:
- Explain approval-gated actions, live supervision, persistent history, and human-in-the-loop design.

### 8. Architecture page copy deck

File:
- `docs/website/architecture-page-copy.md`

Purpose:
- Explain the technical system in a way that is accessible to evaluators and implementers.

### 9. Compare page guidance

File:
- `docs/website/compare-page-guidance.md`

Purpose:
- Define how compare pages should be updated to reflect Ender’s current strengths without unsupported claims.

### 10. Docs / getting started page copy deck

File:
- `docs/website/docs-page-copy.md`

Purpose:
- Bridge the marketing site to the repo docs, quickstart, tutorials, and reference material.

### 11. Blog guidance

File:
- `docs/website/blog-guidance.md`

Purpose:
- Guide future blog content so it stays aligned with the actual product and avoids vague conceptual drift.

### 12. Contact page copy deck

File:
- `docs/website/contact-page-copy.md`

Purpose:
- Provide a practical contact page that supports both direct outreach and self-serve evaluation.

### 13. Visual asset and screenshot plan

File:
- `docs/website/visual-and-screenshot-plan.md`

Purpose:
- Specify which screenshots, UI states, diagrams, and visual treatments the site should use.

### 14. SEO and metadata plan

File:
- `docs/website/seo-and-metadata.md`

Purpose:
- Provide titles, descriptions, keyword themes, and structured metadata guidance.

### 15. Implementation checklist

File:
- `docs/website/implementation-checklist.md`

Purpose:
- Give the next LLM or site builder a concrete checklist to verify that the rebuilt site matches the spec.

## Recommended Read Order for the Next LLM

1. `docs/website/new-site-spec.md`
2. `docs/website/site-deliverables.md`
3. `docs/website/homepage-copy.md`
4. `docs/website/product-page-copy.md`
5. `docs/website/tools-pages-copy.md`
6. `docs/website/workflows-page-copy.md`
7. `docs/website/automation-page-copy.md`
8. `docs/website/safety-page-copy.md`
9. `docs/website/architecture-page-copy.md`
10. `docs/website/compare-page-guidance.md`
11. `docs/website/docs-page-copy.md`
12. `docs/website/contact-page-copy.md`
13. `docs/website/visual-and-screenshot-plan.md`
14. `docs/website/seo-and-metadata.md`
15. `docs/website/implementation-checklist.md`

## Success Criteria

The deliverable set is complete when another LLM can:

- rebuild the site structure without inventing missing pages
- write accurate copy without guessing what Ender does
- create tool pages that reflect the real tool ecosystem
- explain workflows, schedules, safety, and architecture correctly
- preserve truthful positioning and avoid unsupported hype

## Notes

This deliverables list is intentionally broader than a normal marketing brief because Ender is now a substantial product with multiple surfaces, operational concepts, and integration categories. The site should communicate that reality clearly.
