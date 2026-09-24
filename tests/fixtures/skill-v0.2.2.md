---
name: jev-cu-jp
description: Use TypeSafe Jev or Vercel AI Gateway to choose the next action from a short list of visible Computer Use elements, including Japanese interfaces. Use when a user asks for Jev-assisted browser or desktop operation.
license: MIT
---

# Jev + Computer Use

Use the host agent's Computer Use tool to observe and operate the existing window. Use Jev only to choose among visible, labeled elements. The shared decision command is:

`{{NEXT_COMMAND}}`

This command accepts one JSON file path or JSON on stdin and returns one compact JSON object. Set `JEV_PROVIDER=typesafe` with `TYPESAFE_API_KEY`, or `JEV_PROVIDER=vercel` with `AI_GATEWAY_API_KEY`. The command can also read the matching key from this repository's ignored `.env.local`. Never put keys in the input JSON.

## One step

1. Define one small goal and an observable success condition. If the target is already obvious, use Computer Use directly.
2. Observe the current window. Collect 2–40 relevant interactive elements as `{index,role,label}` plus only the short context needed to choose. Use the indices from that exact observation. Exclude screenshots, credentials, cookies, private document contents, and unrelated UI text from the Jev input.
3. Call the shared command with `{goal,app,candidates,context}`. Example: `{"goal":"次の月へ進む","app":"Chrome","candidates":[{"index":56,"role":"button","label":"前の月"},{"index":58,"role":"button","label":"次の月"}],"context":"2026年9月"}`.
4. Match `decision.targetIndex` to the same observation. Review `policy.verdict`, the actual label, the requested action, and the user's existing authorization. `proceed` is a recommendation, not permission. Resolve `confirm`, `escalate`, `stop`, missing targets, and missing action parameters before acting. If the UI changed while deciding, discard the result and observe again.
5. Execute one authorized action with the host Computer Use tool. Observe again and verify the success condition. Stop after two ineffective repeats.

The decision command does not operate the computer. It does not supply coordinates or typed text; derive those only from the user's request and the current UI. Jev's `done` score is not proof of completion. Report the observed result and any manual takeover. To use an already open Chrome profile, have the Computer Use tool attach to that running Chrome session; this skill never copies a profile.
