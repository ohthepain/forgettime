# Issue tracker: GitHub

Issues and specs for Forgettime live in GitHub Issues for `ohthepain/forgettime`:
https://github.com/ohthepain/forgettime/issues

Use the `gh` CLI from this checkout, or pass `--repo ohthepain/forgettime` explicitly.

## Conventions

- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels`; add filters as needed.
- Create: `gh issue create --title "..." --body-file <path>`.
- Update body: `gh issue edit <number> --body-file <path>`.
- Comment: `gh issue comment <number> --body-file <path>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number>`; add a comment when the invoked workflow calls for one.
- For multiline text, write the exact content to a temporary file and use `--body-file`. Preserve real newlines and literal characters.
- Child issues should use native sub-issues when supported. Otherwise, put `Part of #<parent>` at the top of the child body and link the child from a task list on the parent.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill terminology

- "Publish to the issue tracker" means create a GitHub issue.
- "Fetch the relevant ticket" means read the corresponding GitHub issue and its comments.
- A bare issue number is relative to `ohthepain/forgettime`; respect explicitly linked repositories.

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`; its child issues are the tickets.
- Child types use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` as requested by the invoked workflow.
- Use GitHub's native issue dependencies where available. Otherwise, add `Blocked by: #<number>` links at the top of the ticket body.
- The frontier is the first open child in map order with no open blocker or assignee.
- Claim by assigning the issue to the driving developer. Resolve by recording the result, closing the issue and linking the result from the map.

These conventions describe the workflow; they do not schedule work or authorize unsolicited comments or messages.
