# Jev CU JP

[English](README.en.md)

Jev に次の画面操作を選ばせ、実際の画面操作と結果確認はエージェントの Computer Use で行うための小さなツールです。日本語・英語・中国語のアクセシビリティ表示を扱えます。元の [Sac-Y/Jev-cu](https://github.com/Sac-Y/Jev-cu) を基に、日本語対応と共通CLI、Codex・Claude Code・Pi向けの Agent Skill を追加しました。

Jev に送るのは、利用者が選んだ短い目標、候補の役割・ラベル、必要最小限の状態です。スクリーンショットやブラウザのプロファイルは送りません。ただし候補ラベルに個人情報が含まれれば送信対象になるため、呼び出し前に内容を確認してください。

## いちばん簡単な始め方（macOS）

TypeSafeの鍵をクリップボードにコピーしてから実行します。

```bash
brew install moto-taka/tap/jev-cu-jp
jev-cu-jp setup codex --clipboard
```

これでCLIとCodex用Skillが入ります。`setup` はAPIへの短い呼び出しで鍵を確認し、成功した鍵だけを `~/.config/jev-cu-jp/config.json` に本人だけが読める権限で保存します。Codexを再起動したら、たとえば「今開いているChromeでJevを使い、Wikipediaを日本語表示に切り替えて」と頼めます。

Claude CodeやPiでは `setup` の `codex` を `claude` または `pi` に変えてください。Vercel AI Gatewayを使う場合は `jev-cu-jp setup codex --provider vercel --clipboard` です。鍵を更新するときは、同じ `setup` コマンドを再実行します。

Homebrewは画面操作ツールを追加しません。各エージェントが起動中のChromeを操作できる環境は別途必要です。鍵を保存したくない場合は `--clipboard` を省き、利用時に環境変数で渡せます。

### v0.2.2から更新する

既にv0.2.2のSkillを導入した場合は、次を実行してください。

```bash
brew update
brew upgrade moto-taka/tap/jev-cu-jp
jev-cu-jp setup codex --refresh-skill
```

`--refresh-skill` は配布時のままの旧Skillだけを更新します。手で編集したSkillは上書きしません。保存済みの鍵は入れ直す必要がありません。Claude CodeやPiのSkillを更新する場合は、最後のコマンドの `codex` を変更してください。更新後はエージェントを再起動します。

## ソースから使う

Node.js 20 以降を用意し、リポジトリを取得します。外部 npm パッケージは不要です。

```bash
git clone https://github.com/moto-taka/jev-cu-jp.git
cd jev-cu-jp
npm ci
```

接続先を環境変数で指定します。TypeSafe の鍵と Vercel の鍵は別です。

| `JEV_PROVIDER` | 接続先 | 鍵 |
| --- | --- | --- |
| `typesafe`（既定） | [TypeSafe SystemOne API](https://docs.typesafe.ai/api) | `TYPESAFE_API_KEY` |
| `vercel` | [Vercel AI Gateway の TypeSafe 互換 API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) | `AI_GATEWAY_API_KEY` |

```bash
export JEV_PROVIDER=typesafe
export TYPESAFE_API_KEY="your-key"
# Vercel を使う場合:
# export JEV_PROVIDER=vercel
# export AI_GATEWAY_API_KEY="your-gateway-key"
```

鍵は環境変数の代わりに、リポジトリ直下の `.env.local` に入れることもできます。`.env.local` は Git の対象外です。`JEV_PROVIDER` は環境変数で指定します。公開リポジトリ、入力JSON、実行ログに鍵を入れないでください。

## 使い方

画面を観察して、現在の候補だけをJSONにします。付属の例は架空の画面です。

```bash
npm run next -- examples/next-month.json
```

入力:

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

JSONはファイル名を省いて標準入力から渡すこともできます。返却するのは選択した索引、操作の種類、確信度、確認ゲート、利用量です。CLIは画面をクリックしません。選択後は同じ画面状態に対象があることを確かめ、エージェントの Computer Use で一手だけ実行し、画面を読み直して結果を確認してください。

### 画面情報とトークン

Codexで大きな画面情報をそのまま受け取ると、候補だけをJevへ送ってもCodex側のコンテキストは減りません。[Skillの `cua_repl` の例](skills/jev-cu-jp/SKILL.md#keep-ui-observations-compact)は `getAXState({emit:false})` で画面情報をツール内に留め、目的に合う候補だけをCodexへ返します。

2026年9月24日のChromeでの確認では、Wikipedia日本語版の画面情報34,361文字から、検索欄と検索ボタンの候補JSON 90文字だけを返せました。これは画面出力の文字数です。CodexとJevを合わせた課金トークンや処理時間の削減は未計測です。操作対象が明白なら、Jevを呼ばずにComputer Useで直接操作できます。

`policy.verdict` が `proceed` でも操作の許可を意味しません。`confirm` は送信・削除・決済などを含む可能性、`escalate` は判断不足、`stop` は続行停止です。モデルの完了確率だけで成功と報告しないでください。

## Agent Skill

付属の [Skill](skills/jev-cu-jp/SKILL.md) を各エージェントへ登録できます。インストーラーはCLIの絶対パスをSkillに埋め込み、既存の同名Skillがある場合は上書きせず停止します。Homebrew版の `--refresh-skill` は、変更されていない旧版Skillだけを更新します。

```bash
node scripts/install-skill.mjs codex
node scripts/install-skill.mjs claude
node scripts/install-skill.mjs pi
```

登録先はそれぞれ `~/.codex/skills/jev-cu-jp/`、`~/.claude/skills/jev-cu-jp/`、`~/.pi/agent/skills/jev-cu-jp/` です。エージェントを再起動して読み込ませてください。Chromeのログイン状態を使う場合は、各Computer Useツールが**起動中のChrome**を操作できるようにします。このツールはChromeプロファイルをコピーしません。

Homebrew版では `jev-cu-jp setup codex|claude|pi --clipboard` を使います。`jev-cu-jp doctor` で接続先と鍵の有無を確認できます（鍵の値は表示しません）。SkillはHomebrewの更新後も同じCLIを呼ぶように登録されます。

## 検証と制限

```bash
npm test
npm run p0
```

`npm test` は通信しません。`npm run p0` は保存済みの合成画面で選択結果を調べ、選択した接続先の鍵を使用します。結果は無視対象の `runs/` に保存されます。付属の自動ループは特定のComputer Useドライバー向けの参考実装であり、各エージェントの画面操作へ自動的に接続されるわけではありません。実画面の操作成否、利用環境のブラウザ接続、両接続先の実通信は利用環境で確認してください。

## ライセンス

[MIT](LICENSE)。原作者 Sac-Y の著作権表記を保持しています。
