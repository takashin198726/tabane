# ブラウザ版 Slack で「あると便利」な機能候補（2026-09-08 調査）

tabane に次に載せる機能を選ぶための調査メモ。既存拡張・userscript の機能棚卸し、ブラウザ版 Slack への不満（Reddit / HN / GitHub / ブログ）、日本語圏の記事（Qiita / Zenn / note）の 3 方向から集め、tabane の制約で絞り込んだ。

## 評価の前提

- **実装方式は content script + CSS/DOM 注入のみ**。Slack API・トークン・外部バックエンドは使わない
- **壊れにくさを最優先**。CSS だけ、または DOM を読むだけ（書き換えない）の機能ほど Slack の DOM 変更に強い
- **維持されている既存拡張と正面から被るものは避ける**（Slack-Privacy-Extension、Neutral Face Emoji Tools、Slack Custom Emoji Manager など）
- 用途は個人ワークスペース（未審査の拡張を業務 Slack に入れない、という決定は変わらず）

## 候補一覧

| # | 機能 | 領域 | 需要の根拠 | 方式 | DOM 依存リスク | 既存との重複 | 優先度 |
|---|---|---|---|---|---|---|---|
| 1 | **機能ごとの ON/OFF（オプションページ）** | 基盤 | 以降の CSS 系機能を足す前提。UA 偽装の副作用を切りたい人もいる | `chrome.storage` + 動的 CSS/JS 適用 | なし | – | **A** |
| 2 | **グループの折りたたみ** | UI/表示 | 本家 PR #149 系の要望の延長。ネストが出ると次に欲しくなる | 親行クリックで子行を CSS 非表示。既存の `SELECTORS` 内で完結 | 中（仮想リストの再描画で状態を持ち直す必要） | なし（本家にもない） | **A** |
| 3 | **UI ノイズ除去セット** — Activity/Later タブ、トライアルバナー、AI アップセル、Canvas 追加タブ、ホバーツールバーの間引き、リンク展開（unfurl）の折りたたみ | UI/表示 | 不満調査で最多。SlackMinifier / slackfix / Slack Tweaks など 5 件以上が同じ問題を個別に解いている | CSS のみ、項目ごとにトグル | 低（セレクタが変わったら該当項目だけ効かなくなる） | 個別には存在するが、多くは放置または userstyle | **A** |
| 4 | **メッセージを Markdown でコピー** | 投稿・入力 | SlackUtils（96 人）、slack-to-markdown、2025 年のブログ記事 2 本など独立実装が複数。継続的な需要 | DOM を読んで変換、書き換えなし | 低（読み取りのみ。失敗しても表示は壊れない） | SlackUtils は小規模。引用・コードブロック・スレッド対応で差別化可 | **A** |
| 5 | **IME 誤送信防止** — 変換確定の Enter で送信されるのを止める | 投稿・入力 / 日本特有 | ITmedia 2018、Qiita、Zenn 2026-08 と繰り返し記事化 | `keydown` の `isComposing` / `compositionend` 直後の Enter を握りつぶす | 中（エディタのキー処理に割り込む） | 専用拡張は見当たらない | **B**（現行 Slack が `isComposing` を正しく扱っているか要検証。扱えていれば不要） |
| 6 | **`:done:` リアクション付きメッセージを薄く／隠す** | 通知・未読 | 「Slack メッセージ非表示」拡張（12 人）。個人 times やタスク運用向け | リアクション検出 + クラス付与 | 中 | 既存は極小規模で放置気味 | **B** |
| 7 | **リアクション定型セット** — 1 クリックで複数リアクション、朝の挨拶へのまとめリアクション | 投稿・入力 / 日本特有 | KAYAC「ワイワイできるくん」、Qiita 便乗リアクション。出退勤挨拶文化 | リアクションボタンのクリック自動化 | 高（絵文字ピッカーの DOM に依存） | 社内ツール止まり | **C**（自動リアクションはスパム寄り。手動 1 クリックに限定するなら可） |
| 8 | **Draft によるサイドバー並び替えの固定** | 検索・ナビ | HN で指摘、共感多数 | サイドバー DOM 順序の監視 | 高（並び順を書き換えると仮想リストと衝突） | なし | **C** |
| 9 | **メッセージ列の幅・密度の追加調整** | UI/表示 | 公式 Compact で足りない人向け | CSS のみ | 低 | Tight（放置）と重なる | **C**（公式設定との差が小さい） |
| 10 | **未読数をタブタイトル / favicon に表示** | 通知・未読 | Refined / View Optimizer にあった | `document.title` + Canvas favicon | 低 | View Optimizer が現役 | **C** |
| 11 | **スレッドのインライン展開** | UI/表示 | 「スレッドが埋もれる」不満（日本語記事でも） | 大規模 DOM 操作 | 高 | なし | **見送り**（壊れやすさが最大級） |

## 推奨する次の 3 本

1. **#1 オプションページ**（基盤）。以降の CSS 系機能を「項目ごとに ON/OFF できる」形で載せるための前提。UA 偽装も切れるようにする
2. **#4 Markdown コピー**。読み取りのみで壊れにくく、需要が継続していて、既存実装が小規模。tabane の「壊れにくさ優先」に最も合う
3. **#3 UI ノイズ除去セット** または **#2 グループ折りたたみ**。前者は需要が最も多く CSS だけで済む。後者はグルーピングの延長で「多階層ならでは」の差別化になる

## やらないと決めたもの

| 機能 | 理由 |
|---|---|
| 在席状態の維持（Away 防止）、タイピング表示の隠蔽 | Slack API 仕様変更で slack-keep-presence が停止した前例。方針違反（API 依存）でもある |
| 一括削除・エクスポート | DOM スクレイピングで実装可能だが、DM・プライベートチャンネルの持ち出しに近く、ガバナンス上の懸念と正面衝突する |
| 翻訳・AI 返信・文法チェック | 外部 API キーとバックエンドが前提。乱立分野でもある |
| タブを閉じても通知 | content script では原理的に不可能 |
| Cookie からトークンを取って Slack API を叩く | DevelopersIO 記事の著者自身が非推奨と明言。反面教師 |
| 画面共有時のぼかし | Slack-Privacy-Extension が 2026-01 まで更新されており十分 |
| カスタム絵文字の一括登録 | Neutral Face Emoji Tools（1 万人）と Slack Custom Emoji Manager（6 千人）が現役 |
| ダークテーマ | 6 本以上が存在し、いずれも DOM 変更との追いかけっこで放置されがち |

## 調査で分かった構造的な事実

- 既存拡張は **同じ機能を別々に何度も作り直している**（ダークテーマ 6 本、絵文字一括登録 5 本、翻訳 4〜5 本、Away 防止 3 本以上）。統合して「項目ごとに ON/OFF」にする余地は大きい
- **CSS だけで完結する機能が最も長生き**している。DOM 注入は機能の幅が広いが Slack の変更に弱く、API 依存は仕様変更で完全停止する
- 日本特有の需要は **IME の Enter 問題** と **出退勤挨拶へのリアクション文化** に集中している
- Slack 公式設定で既に解決できるもの（アニメーション停止、24 時間表記、WYSIWYG 無効化、Compact 表示）は、記事化されるほど見つけにくいだけで、拡張で作る価値は薄い

## 主な出典

- 既存拡張: [Refined](https://github.com/g3rv4/Refined)、[Tight](https://github.com/rileytomasek/tight)、[Slack View Optimizer](https://chromewebstore.google.com/detail/slack-view-optimizer/locdplfifjadobbmoamhlabnkhcaelkm)、[Slack-Privacy-Extension](https://github.com/33j33/Slack-Privacy-Extension)、[SlackMinifier](https://github.com/WesCook/SlackMinifier)、[slackfix](https://github.com/dkoes/slackfix)、[hide-slack-activity](https://github.com/garnetred/hide-slack-activity)、[slack-keep-presence](https://github.com/eskerda/slack-keep-presence)（停止）、[Neutral Face Emoji Tools](https://chromewebstore.google.com/detail/neutral-face-emoji-tools/anchoacphlfbdomdlomnbbfhcmcdmjej)、[SlackUtils](https://chromewebstore.google.com/detail/slackutils/kljjdpaicefcaofhajdnpokmiflaagja)、[slack-to-markdown](https://github.com/cozmo/slack-to-markdown)
- 不満・要望: [HN: Is Slack getting worse?](https://news.ycombinator.com/item?id=39944054)、[HN: drafts reorder channels](https://news.ycombinator.com/item?id=21697188)、[Stanford UIT: My Take on the New Slack Experience](https://uit.stanford.edu/news/my-take-new-slack-experience)、[jvt.me: Slack to Markdown](https://www.jvt.me/posts/2025/04/19/slack-external-markdown/)、[dev.to: Slack workspaces in the browser](https://dev.to/nicolasbeauvais/slack-workspaces-in-the-browser-5470)
- 日本語圏: [ITmedia: Slack に送信ボタンを追加](https://atmarkit.itmedia.co.jp/ait/articles/1804/25/news035.html)、[Zenn: Enter で送信は滅びよ](https://zenn.dev/safie_inc/articles/ee72b837e4a5f1)、[Qiita: 便乗リアクション拡張](https://qiita.com/bitto/items/05d2d0805ee247f38826)、[techtekt: customize-slack](https://techtekt.persol-career.co.jp/entry/tech/221204_01)、[Qiita: 返信ボタン拡張](https://qiita.com/gam0022/items/9cce1d118bc42dc0e212)、[KAYAC: ワイワイできるくん](https://techblog.kayac.com/waiwai_slack)、[DevelopersIO: Slack 検索拡張（非推奨手法）](https://dev.classmethod.jp/articles/slack-search-from-chrome-extension/)、[decomoji](https://github.com/decomoji/decomoji)
