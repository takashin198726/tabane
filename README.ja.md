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
| **ノイズ除去** – トライアル／アップグレード／ヒントのバナーをヒューリスティック（バナーらしいクラス名 + 文言）で隠す。後から Slack が足す訴求にも効く。レールのタブ・ショートカット番号・ツールバーのボタン・未読バナーは項目ごとに ON/OFF | `app.slack.com` | ヒューリスティックは**実 Slack で動作確認済み**（Slack のヒントバナーを非表示）。トライアル・通知バナーは fixture で検証 |

グルーピング・コピー・ノイズ除去・ワークスペース列はオプションページで ON/OFF できます（`chrome://extensions` →
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
DOM 層を確認する用途です。

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
