<!--
  ============================================================
  REVIEWER ROUTING — cognios fork only (Paperclip agents read first)
  ============================================================

  This is netverse77/cognios — a fork. Standing autonomous-merge auth
  applies ONLY to netverse77/cogni-os, NOT to this repo. PRs here
  require explicit CTO architecture review before merge.

  If you are a Paperclip agent and opened this PR:

    1. Move the Paperclip ticket to `in_review` when this PR opens.
    2. As soon as CI is green, post a comment on the Paperclip issue
       thread that:
         - Links this PR
         - States "CI green"
         - @-mentions the CTO (Kira) to request architecture review
    3. The ticket stays `in_review` until the CTO approves AND a
       maintainer merges. Do not close the ticket as `done` before
       merge — see "Definition of done" in agenticOS/CLAUDE.md.
    4. Do NOT exit your heartbeat with this PR green-but-unreviewed.
       If you must leave, the @CTO mention on the Paperclip thread
       must be in place first.
    5. If this PR sits >1h post-green without a CTO comment, page
       the board on the issue thread.

  Why route via Paperclip thread instead of GitHub CODEOWNERS:
  every fork PR is authored by `@netverse77` (the single account
  Paperclip agents push under), and GitHub skips PR-author from
  review-request — so CODEOWNERS routing is structurally broken
  for this fork. Routing must happen on the Paperclip side.

  Out of scope here: extending standing autonomous-merge auth to
  this repo — that requires a separate board approval.
-->

## Thinking Path

<!--
  Required. Trace your reasoning from the top of the project down to this
  specific change. Start with what Paperclip is, then narrow through the
  subsystem, the problem, and why this PR exists. Use blockquote style.
  Aim for 5–8 steps. See CONTRIBUTING.md for full examples.
-->

> - Paperclip orchestrates AI agents for zero-human companies
> - [Which subsystem or capability is involved]
> - [What problem or gap exists]
> - [Why it needs to be addressed]
> - This pull request ...
> - The benefit is ...

## What Changed

<!-- Bullet list of concrete changes. One bullet per logical unit. -->

-

## Verification

<!--
  How can a reviewer confirm this works? Include test commands, manual
  steps, or both. For UI changes, include before/after screenshots.
-->

-

## Risks

<!--
  What could go wrong? Mention migration safety, breaking changes,
  behavioral shifts, or "Low risk" if genuinely minor.
-->

-

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

<!--
  Required. Specify which AI model was used to produce or assist with
  this change. Be as descriptive as possible — include:
    • Provider and model name (e.g., Claude, GPT, Gemini, Codex)
    • Exact model ID or version (e.g., claude-opus-4-6, gpt-4-turbo-2024-04-09)
    • Context window size if relevant (e.g., 1M context)
    • Reasoning/thinking mode if applicable (e.g., extended thinking, chain-of-thought)
    • Any other relevant capability details (e.g., tool use, code execution)
  If no AI model was used, write "None — human-authored".
-->

-

## Checklist

- [ ] I have included a thinking path that traces from project context to this change
- [ ] I have specified the model used (with version and capability details)
- [ ] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [ ] I have run tests locally and they pass
- [ ] I have added or updated tests where applicable
- [ ] If this change affects the UI, I have included before/after screenshots
- [ ] I have updated relevant documentation to reflect my changes
- [ ] I have considered and documented any risks above
- [ ] I will address all Greptile and reviewer comments before requesting merge
- [ ] (Paperclip-agent PRs only) Once CI is green, I will @-mention the CTO on the Paperclip issue thread, move the ticket to `in_review`, and not close as `done` until the PR is merged
