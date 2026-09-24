# Jev CU JP

[日本語](README.md)

Jev chooses the next action from short labels observed in a browser or desktop app. The host agent's Computer Use tool performs the action and checks the result. This is based on [Sac-Y/Jev-cu](https://github.com/Sac-Y/Jev-cu), with Japanese UI support, a shared CLI, and an Agent Skill for Codex, Claude Code, and Pi.

Only the goal, candidate roles and labels, and a short context are sent to Jev. Screenshots and Chrome profiles are not sent. Candidate labels can themselves contain personal data, so inspect them before each request.

## Setup

Requires Node.js 20 or newer. There are no external npm packages.

```bash
git clone https://github.com/moto-taka/jev-cu-jp.git
cd jev-cu-jp
npm ci
```

Choose the provider explicitly:

| `JEV_PROVIDER` | API | Key |
| --- | --- | --- |
| `typesafe` (default) | [TypeSafe SystemOne](https://docs.typesafe.ai/api) | `TYPESAFE_API_KEY` |
| `vercel` | [Vercel AI Gateway TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) | `AI_GATEWAY_API_KEY` |

```bash
export JEV_PROVIDER=typesafe
export TYPESAFE_API_KEY="your-key"
# For Vercel instead:
# export JEV_PROVIDER=vercel
# export AI_GATEWAY_API_KEY="your-gateway-key"
```

You can put the matching key in the repository root's ignored `.env.local`; set `JEV_PROVIDER` in the environment. Never put keys in public files, input JSON, or logs.

## Decide one step

```bash
npm run next -- examples/next-month.json
```

The synthetic example contains:

```json
{
  "goal": "次の月へ進む",
  "app": "Chrome",
  "candidates": [
    {"index": 56, "role": "button", "label": "前の月"},
    {"index": 58, "role": "button", "label": "次の月"}
  ],
  "context": "2026年9月"
}
```

The CLI also accepts JSON on stdin. It returns the selected index, action type, confidence, policy verdict, and usage. It does not click. Confirm that the selected index still points to the same element, perform one authorized action with the host's Computer Use tool, then observe the result. A `proceed` verdict is a recommendation, not authorization. A Jev `done` score alone does not prove completion.

## Agent Skill

Install the [Skill](skills/jev-cu-jp/SKILL.md) for each host you use:

```bash
node scripts/install-skill.mjs codex
node scripts/install-skill.mjs claude
node scripts/install-skill.mjs pi
```

It installs to `~/.codex/skills/jev-cu-jp/`, `~/.claude/skills/jev-cu-jp/`, or `~/.pi/agent/skills/jev-cu-jp/`, embeds the absolute CLI path, and refuses to overwrite an existing skill. Restart the host after installation. To use an already open Chrome profile, configure the host's Computer Use tool to control that running session. This repository never copies a profile.

## Verification and limitations

```bash
npm test
npm run p0
```

`npm test` needs no network or key. `npm run p0` evaluates saved synthetic UI snapshots using the selected provider and writes ignored results to `runs/`. The included automation loop is a reference implementation for a particular Computer Use driver; it is not automatically wired into every host. Verify live GUI behavior, browser access, and both providers' connectivity in your own environment.

## License

[MIT](LICENSE), retaining Sac-Y's copyright notice.
