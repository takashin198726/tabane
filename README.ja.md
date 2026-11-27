# tabane（束ね）

Slack のサイドバーのチャンネルを、名前の接頭辞で**多階層のツリーにまとめる** MV3 Chrome 拡張です。
あわせて、ブラウザで Slack を使うときの小さな不便をいくつか直します。

English version: [README.md](README.md)

```
# general
# proj┬/
#     ├dev┬backend
#     │   └frontend
#     ├ops┬a
#         └b
# random
```

## なぜ作ったか

[yamadashy/slack-channels-grouping](https://github.com/yamadashy/slack-channels-grouping) は
1 階層の接頭辞グルーピングをしてくれますが、更新が止まっています。多階層（ネスト）対応は
[PR #149](https://github.com/yamadashy/slack-channels-grouping/pull/149) で提案されたまま
Draft で止まっています。本リポジトリはネストを中心機能に据えたゼロからの書き直しです。
ビルド不要・実行時依存なしにして、Slack 側の DOM 変更への追従コストを下げています。

## 機能

| 機能 | 動作する URL | 状態 |
|---|---|---|
| **サイドバーのグルーピング** – `-` / `_` 区切りの接頭辞で最大 3 階層のツリー表示。グループの `┬` をクリックすると折りたたみ、先頭行が `proj ▸ 5` になる（隠した行に未読があれば太字 + メンション数バッジ）。折りたたみ状態はワークスペースごとに記憶 | `app.slack.com` | グルーピング・折りたたみとも**実 Slack で動作確認済み**（2026-09-08） |
| **ブラウザで開く** – デスクトップアプリを待たず「ブラウザで Slack を使う」リンクを踏む | `*.slack.com/archives/*`, `*.slack.com/ssb/redirect*` | [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App) からの移植。**実 Slack で動作確認済み**（2026-09-08、シークレットウィンドウ） |
| **ワークスペース切替バー** – Slack 自身が持つワークスペース列（ログイン中のワークスペースごとに 1 アイコン）を常時表示。ChromeOS の UA で全ワークスペースを列に載せ、CSS で隠された列を表示 | `app.slack.com` | **実 Slack で動作確認済み**（2026-09-08、6 ワークスペース） |
| **Markdown でコピー** – ホバーツールバーのボタンで、メッセージを GitHub 風 Markdown（`text/plain`）と HTML（`text/html`）の両方でクリップボードへ。Markdown エディタには Markdown として、Slack に貼り戻すと書式付きで入る。Shift+クリックで引用元行（投稿者・時刻・チャンネル・パーマリンク）付き。転送メッセージは帰属付きの引用になり、スレッド枠ヘッダのボタンでスレッド全体を返信ごとの帰属行付きでコピーできる | `app.slack.com` | 単体・スレッド一括・転送メッセージのコピーとも**実 Slack で動作確認済み**（2026-09-08） |
| **メンションのグループ入れ替え** – 入力欄で人への @メンションを確定すると、その人が所属するユーザーグループを小さな一覧で表示（人数の少ない順、人数付き）。選ぶと人のメンションがグループメンションに入れ替わる。Tab で一覧へ移動、Esc で閉じる。所属情報は、オプションページでワークスペースごとに登録したトークンを使って Slack API から取得する。登録のないワークスペースでは何も表示しない | `app.slack.com`、およびバックグラウンドから `slack.com/api` | **実 Slack では未検証。** 一覧・入れ替え・フォールバックは fixture で検証（2026-11-27）。入力欄のセレクタは推定 |
| **ノイズ除去** – トライアル／アップグレード／ヒントのバナーをヒューリスティック（バナーらしいクラス名 + 文言）で隠す。後から Slack が足す訴求にも効く。レールのタブ・ショートカット番号・ツールバーのボタン・未読バナーは項目ごとに ON/OFF | `app.slack.com` | ヒューリスティックは**実 Slack で動作確認済み**（Slack のヒントバナーを非表示）。トライアル・通知バナーは fixture で検証 |

グルーピング・コピー・メンションのグループ入れ替え・ノイズ除去・ワークスペース列はオプションページで ON/OFF できます（`chrome://extensions` →
tabane → **詳細** → **拡張機能のオプション**）。「ブラウザで開く」と ChromeOS 偽装は常時 ON です。

## インストール

1. `chrome://extensions` を開く
2. 右上の **デベロッパーモード** を ON
3. **パッケージ化されていない拡張機能を読み込む** → このディレクトリを選択

Chrome 111 以降が必要です（`"world": "MAIN"` のコンテンツスクリプトを使うため）。

### どこで使うか

審査を受けていない、Slack の DOM を書き換える拡張です。会社のワークスペースに入れると
情シス・監査上の懸念になり得ます。作者は**個人ワークスペースでのみ**使っています。
組織で使うかどうかは各自で判断してください。

メンションのグループ入れ替えだけは、ユーザーグループがある環境（有料プラン）でしか意味がなく、
実質的に会社のワークスペース向けです。拡張そのものに加えて Slack アプリのトークンが必要で、
そのアプリはワークスペース管理者の承認が要る場合があります。

## メンションのグループ入れ替えと Slack API

tabane の他の機能はページを読んで書き換えるだけです。この機能だけが例外で、誰がどの
ユーザーグループに所属するかは Slack のページからは分からないため、Slack API に問い合わせます。

- **呼ぶもの。** `auth.test`（トークンがどのワークスペースのものか）と、`include_users` 付きの
  `usergroups.list`（グループとメンバーの ID）。どちらも読み取り専用で、必要なスコープは
  `usergroups:read` です。それ以外（名前・メールアドレス・メッセージ）は取得しません。
- **誰のトークンか。** 自分で作った Slack アプリのボットトークン（`xoxb-`）またはユーザー
  トークン（`xoxp-`）を、オプションページにワークスペースごとに 1 つ貼り付けます。ブラウザの
  セッショントークン（`xoxc-`、`xoxd-`）は受け付けません。ログイン中のセッションは流用せず、
  認証情報を得るために Slack の Cookie やページのストレージを読むこともしません。
- **トークンの行き先。** `chrome.storage.local` に保存します（このブラウザプロファイルのみ。
  同期されず、暗号化もされません）。送信先は `https://slack.com/api/` だけで、`Authorization`
  ヘッダに入れ、Cookie は付けません。Slack のページのスクリプトからは拡張のストレージを
  読めませんが、tabane 自身のスクリプトからは読めます。
- **データの鮮度。** トークン登録時、オプションページの **再取得**、そして取得から 6 時間を
  過ぎた後の最初の問い合わせ時にバックグラウンドで取得します（失敗後は 15 分待ちます）。
  所属の変更が反映されるまで、その分の遅れがあり得ます。
- **入れ替えの仕組み。** tabane はメンションのマークアップを自分では書きません。人のメンションを
  選択し、キーボードと同じ経路で `@handle` を上書き入力して、Slack 自身の補完候補から一致する
  行をクリックします。メッセージに入るグループメンションは Slack が作ったものです。行が
  見つからないときは入力した `@handle` を残し、Enter での確定を促すヒントを出します。
- **一覧が出る条件。** メンションを 1 つ確定した直後で、カーソルがその直後にあるときだけです。
  下書きの復元・貼り付け・メッセージの編集では出しません。
- **制限。** ワークスペース単位のトークンのみ対応です。Enterprise Grid では OrG の URL に対して
  1 つのワークスペースのトークンを使い、OrG レベルのトークンには対応しません。トークン
  ローテーションを有効にしたアプリのトークン（`xoxe…`）にも対応しません。

## グルーピングの仕組み

- チャンネル名を `-` と `_` で分割します。サイドバー上で前**または**後ろの項目が先頭 *d* 個の
  セグメントを共有していれば、深さ *d* でグルーピングされます。
- 各行は、グルーピングされた階層ごとに `ラベル + 罫線` を並べ、最後に残りの名前を表示します。
  ラベルはグループの先頭行だけ見せ、以降の行は同じ幅のまま不可視にして罫線を揃えます。
- 名前全体が接頭辞と一致するチャンネル（`proj-dev` の隣の `proj`）はグループのルートになり、
  `proj┬/` と表示します。
- DM・グループ DM・セクション見出し・ボタンはグルーピングせず、グループの区切りにもなります。
- ネストの深さ（1〜4）はオプションページで設定します。
- 折りたたみは、グループの他の行を隠し、その下の行を `transform` で上に詰めます（Slack はサイドバーの行を絶対配置しているため）。リストの高さは Slack のままなので、畳んだ分だけ下端に空きができます。Slack が描画している行だけが対象なので、数百チャンネルある長いサイドバーでは、画面外の行がスクロールで現れるまでずれが出ることがあります。
- 位置ベースの処理なので、関連チャンネルが隣り合っている必要があります。サイドバーを
  アルファベット順にしてください。

グルーピングのルールは DOM に触らない純粋関数 [`src/grouping.js`](src/grouping.js) にあり、
[`test/grouping.test.js`](test/grouping.test.js) でテストしています。

## Slack DOM への依存

Slack 拡張の死因はいつも同じで、Slack がマークアップを変え、誰もセレクタを直さないことです。
追従を安くするため、各コンテンツスクリプトはセレクタを冒頭の `SELECTORS` ブロックに集約し、
ノイズ除去のルールは [`src/lib/noise.js`](src/lib/noise.js) の `NOISE_RULES`、ワークスペース列は
[`src/workspace-switcher.css`](src/workspace-switcher.css) の 2 ルールにまとめています。

| キー | セレクタ / 属性 | 用途 |
|---|---|---|
| `list` | `.p-channel_sidebar__static_list` | 監視対象のコンテナ。ワークスペース切替で作り直される |
| `items` | `[role="listitem"], [role="treeitem"]` | サイドバーの 1 行 |
| `channel` + `channelTypeAttr` | `.p-channel_sidebar__channel[data-qa-channel-sidebar-channel-type]` | `channel` / `private` / `im` / `mpim` |
| `name` | `.p-channel_sidebar__name` | チャンネル名のテキストを持つ要素 |
| `nameKeyAttr` | name 要素の `data-qa` | 仮想リストの行が別チャンネルに再利用されると Slack が書き換える。再描画のトリガに使用 |
| `unreadClass` / `badge` | `.p-channel_sidebar__channel--unread`, `.p-channel_sidebar__badge` | 未読とメンション数。折りたたんだ行に集約して表示 |
| （CSS） | `.p-workspace_switcher_prototype` | ワークスペース列のコンテナ。ブラウザでは `display: none` で、ポップオーバーとして開くまで隠れている |
| （CSS） | `.p-client_workspace_wrapper` | クライアント本体。列の横に並ぶよう 60px 右にずらす |
| copy `message` / `actionsGroup` | `[data-qa="message_container"]`, `[data-qa="message-actions"]` | メッセージとホバーツールバー。ここにコピーボタンを差し込む |
| copy `richText` | `.p-rich_text_block` と `data-stringify-*` 属性 | 描画済みの本文。属性が太字・斜体・コード・引用・リスト・絵文字・メンションを表す |
| copy `sender` / `timestamp` | `[data-qa="message_sender_name"]`, `a.c-timestamp`（`href`, `data-ts`） | Shift+クリック時の引用元行 |
| copy `attachment` / `forwardedCard` | `.c-message_attachment`, `[data-qa="forwarded_message_card"]`（`[class^="byline"]`, `[class^="context"]`） | 転送メッセージ。投稿者・日付・場所付きの引用にする |
| copy `threadPane` / `threadHeader` | `[data-qa="threads_flexpane"]`, `.p-flexpane_header`, `[data-qa="secondary-header-more"]` | スレッド枠。「その他」の前にスレッドコピーのボタンを置く |
| mention `editor` | `.ql-editor` | 入力欄のリッチテキストエディタ。ここでメンションを監視し、上書き入力する |
| mention `mention` + `idAttr` | `ts-mention`, `data-id` | 確定済みのメンション。ID が `U`/`W` で始まれば人、`S` ならユーザーグループ。**推定。実 Slack では未確認** |
| mention `autocompleteOption` | `[role="listbox"] [role="option"]`, `[data-qa="texty_autocomplete_menu"] [role="option"]`, `.c-texty_autocomplete__result` | Slack 自身の @ 補完候補の行。`@handle` と完全一致する行をクリックする。**推定。実 Slack では未確認** |
| noise rules | `[data-qa="tab_rail_*_button"]`, `.p-tab_rail__shortcut_hint`, `.p-message_pane__unread_banner` など | 固定の非表示ルール。`src/lib/noise.js` の `NOISE_RULES` |
| noise heuristic | `[class*="banner"]`, `[class*="upsell"]`, `[class*="trial"]` など + 文言 | トライアル／訴求／ヒントの判定対象 |

前提: Slack はチャンネル名を `.p-channel_sidebar__name` にプレーンテキスト（`textContent`）で
書き込む。そのため行が再描画されると当拡張の span は置き換えられ、observer が検知できる。

## 開発

```
npm test                      # node --test。依存パッケージなし
python3 -m http.server 8765   # http://localhost:8765/test/fixture/ を開く
python3 tools/make-icons.py   # アイコン再生成（Pillow が必要）
```

`test/fixture/index.html` は模擬 Slack サイドバーで、Slack が実行時にやること（行の再利用・
チャンネル追加・ワークスペース切替・未読の太字）をボタンで再現できます。拡張を読み込まずに
DOM 層を確認する用途です。模擬の入力欄と Slack の補完の代役もあり、メンションの確定・下書きの
復元・補完が開かない状況をボタンで再現できます。所属グループの問い合わせには、バックグラウンド
の代わりにスタブが答えます。

## ロードマップ

機能候補と選定理由は [docs/feature-candidates.md](docs/feature-candidates.md) にまとめています。

- Tampermonkey 向け userscript ビルド
- Chrome Web Store への公開

## クレジット

- [yamadashy/slack-channels-grouping](https://github.com/yamadashy/slack-channels-grouping) – 1 階層グルーピングの元祖と DOM セレクタ
- [PR #149](https://github.com/yamadashy/slack-channels-grouping/pull/149) – 多階層グルーピングの提案
- [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App)
- [leoluk/slack-workspace-sidebar](https://github.com/leoluk/slack-workspace-sidebar)、[Nevkontakte「Workspace switcher bar for Slack in browser」](https://m.nevkontakte.com/articles/76e1af3/workspace-switcher-bar-for-slack-in-browser) – ChromeOS への UA 偽装。2026-09 時点では必要だが十分ではない（全ワークスペースを列に載せる効果はあるが、列自体はポップオーバーに隠されたままなので、tabane は CSS でも表示している）

## ライセンス

[MIT](LICENSE)
