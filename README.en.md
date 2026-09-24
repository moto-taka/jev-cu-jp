# Jev CU JP

[日本語](README.md)

Jev chooses the next action from short labels observed in a browser or desktop app. The host agent's Computer Use tool performs the action and checks the result. This is based on [Sac-Y/Jev-cu](https://github.com/Sac-Y/Jev-cu), with Japanese UI support, a shared CLI, and an Agent Skill for Codex, Claude Code, and Pi.

Only the goal, candidate roles and labels, and a short context are sent to Jev. Screenshots and Chrome profiles are not sent. Candidate labels can themselves contain personal data, so inspect them before each request.

## Quick start on macOS

Copy your TypeSafe key to the clipboard, then run:

```bash
brew install moto-taka/tap/jev-cu-jp
jev-cu-jp setup codex --clipboard
```

The CLI and Codex Skill are installed. Setup makes one short API call to verify the key before saving it in `~/.config/jev-cu-jp/config.json` with owner-only permissions. You can rerun the same setup command to update the key. Restart Codex, then ask it to use jev-cu-jp in your open Chrome window. Replace `codex` with `claude` or `pi` for those hosts. For Vercel AI Gateway, use `jev-cu-jp setup codex --provider vercel --clipboard`.

If you installed the v0.2.2 Skill, upgrade the CLI and run `jev-cu-jp setup codex --refresh-skill`. It updates only an unmodified distributed Skill. Your saved key does not need to be entered again.

Homebrew does not provide a Computer Use tool. Each host still needs a way to control the running browser. Omit `--clipboard` if you prefer to provide the key through an environment variable at runtime.

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

To save agent context, filter large UI observations inside the Computer Use tool before returning them to the agent. The [Skill shows a Codex `cua_repl` example](skills/jev-cu-jp/SKILL.md#keep-ui-observations-compact). On one Japanese Wikipedia page, this reduced 34,375 characters of UI output to 155 characters of relevant candidates. This measures UI output characters, not total billed tokens or end-to-end speed across Codex and Jev. Skip the Jev call when the target is already clear.

## Agent Skill

Install the [Skill](skills/jev-cu-jp/SKILL.md) for each host you use:

```bash
node scripts/install-skill.mjs codex
node scripts/install-skill.mjs claude
node scripts/install-skill.mjs pi
```

It installs to `~/.codex/skills/jev-cu-jp/`, `~/.claude/skills/jev-cu-jp/`, or `~/.pi/agent/skills/jev-cu-jp/`, embeds the absolute CLI path, and refuses to overwrite an existing skill. Homebrew's `--refresh-skill` updates only an unmodified earlier release. Restart the host after installation. To use an already open Chrome profile, configure the host's Computer Use tool to control that running session. This repository never copies a profile.

With Homebrew, use `jev-cu-jp setup codex|claude|pi --clipboard` instead. `jev-cu-jp doctor` reports the provider and whether a key is available, without printing the key. The installed Skill points to a stable Homebrew command across upgrades.

## Verification and limitations

```bash
npm test
npm run p0
```

`npm test` needs no network or key. `npm run p0` evaluates saved synthetic UI snapshots using the selected provider and writes ignored results to `runs/`. The included automation loop is a reference implementation for a particular Computer Use driver; it is not automatically wired into every host. Verify live GUI behavior, browser access, and both providers' connectivity in your own environment.

## License

[MIT](LICENSE), retaining Sac-Y's copyright notice.
