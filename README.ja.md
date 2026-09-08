# tabane（束ね）

Slack のサイドバーのチャンネルを、名前の接頭辞で**多階層のツリーにまとめる** MV3 Chrome 拡張です。
あわせて、ブラウザで Slack を使うときの小さな不便を 2 つ直します。

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
| **サイドバーのグルーピング** – `-` / `_` 区切りの接頭辞で最大 3 階層のツリー表示 | `app.slack.com` | `test/fixture/` の模擬サイドバーで検証済み。**実 Slack では未検証** |
| **ブラウザで開く** – デスクトップアプリを待たず「ブラウザで Slack を使う」リンクを踏む | `*.slack.com/archives/*`, `*.slack.com/ssb/redirect*` | [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App) からの移植。未検証 |
| **ワークスペース切替バー** – UA に ` CrOS` を足して切替サイドバーを常時表示 | `app.slack.com` | [leoluk/slack-workspace-sidebar](https://github.com/leoluk/slack-workspace-sidebar) からの移植。未検証 |

3 機能とも常時 ON です。機能ごとの ON/OFF はロードマップにあります。

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
- ネストは 3 階層まで（`src/sidebar-grouping.js` の `MAX_DEPTH`）。
- 位置ベースの処理なので、関連チャンネルが隣り合っている必要があります。サイドバーを
  アルファベット順にしてください。

グルーピングのルールは DOM に触らない純粋関数 [`src/grouping.js`](src/grouping.js) にあり、
[`test/grouping.test.js`](test/grouping.test.js) でテストしています。

## Slack DOM への依存

Slack 拡張の死因はいつも同じで、Slack がマークアップを変え、誰もセレクタを直さないことです。
追従を安くするため、セレクタは [`src/sidebar-grouping.js`](src/sidebar-grouping.js) 冒頭の
`SELECTORS` ブロックに集約しています。

| キー | セレクタ / 属性 | 用途 |
|---|---|---|
| `list` | `.p-channel_sidebar__static_list` | 監視対象のコンテナ。ワークスペース切替で作り直される |
| `items` | `[role="listitem"], [role="treeitem"]` | サイドバーの 1 行 |
| `channel` + `channelTypeAttr` | `.p-channel_sidebar__channel[data-qa-channel-sidebar-channel-type]` | `channel` / `private` / `im` / `mpim` |
| `name` | `.p-channel_sidebar__name` | チャンネル名のテキストを持つ要素 |
| `nameKeyAttr` | name 要素の `data-qa` | 仮想リストの行が別チャンネルに再利用されると Slack が書き換える。再描画のトリガに使用 |

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

- 個人ワークスペースの実 Slack で 3 機能を検証
- 機能ごとの ON/OFF（オプションページ）
- Tampermonkey 向け userscript ビルド
- Chrome Web Store への公開

## クレジット

- [yamadashy/slack-channels-grouping](https://github.com/yamadashy/slack-channels-grouping) – 1 階層グルーピングの元祖と DOM セレクタ
- [PR #149](https://github.com/yamadashy/slack-channels-grouping/pull/149) – 多階層グルーピングの提案
- [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App)
- [leoluk/slack-workspace-sidebar](https://github.com/leoluk/slack-workspace-sidebar)

## ライセンス

[MIT](LICENSE)
