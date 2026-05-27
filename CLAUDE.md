# CLAUDE.md

このファイルは、このリポジトリで作業する際の Claude Code 向けガイドラインです。

## プロジェクト概要

Google Apps Script (GAS) のスクリプトをローカルで管理するプロジェクトです。
[clasp](https://github.com/google/clasp)（Command Line Apps Script Projects）を使って、
ローカルのコードと GAS プロジェクトを同期します。

- 言語: JavaScript / Google Apps Script（必要に応じて TypeScript）
- 設定ファイル: `.clasp.json`（スクリプト ID と紐付け）、`appsscript.json`（マニフェスト）

## clasp 運用

```bash
# 初回ログイン（ブラウザ認証）
clasp login

# 既存の GAS プロジェクトをクローン（スクリプト ID を指定）
clasp clone <SCRIPT_ID>

# 新規 GAS プロジェクトを作成
clasp create --title "<プロジェクト名>"

# ローカルの変更を GAS へ反映
clasp push

# GAS 側の変更をローカルへ取得
clasp pull

# ブラウザで GAS エディタを開く
clasp open
```

- `clasp push` は GAS 側を上書きします。push 前に `clasp pull` で差分がないか確認すること。
- `.clasp.json` にはスクリプト ID が含まれます。機密ではありませんが、共有環境では取り扱いに注意。
- 認証情報（`~/.clasprc.json` や `.clasp.json` 内のトークン等）は **絶対にコミットしない**。

## Git 運用ルール

**コードを変更するたびに、必ず GitHub へプッシュすること。**

作業の基本フロー:

```bash
# 1. 変更内容を確認
git status
git diff

# 2. ステージング
git add -A

# 3. コミット（変更内容が分かるメッセージを付ける）
git commit -m "<変更内容の要約>"

# 4. GitHub へプッシュ
git push
```

運用上の約束:

- **1 つのまとまった変更ごとにコミットし、その都度 `git push` する。** 変更をローカルに溜め込まない。
- コミットメッセージは「何を・なぜ変更したか」が分かる内容にする。
- 機密情報（API キー、トークン、認証情報、`.clasprc.json` など）はコミットしない。`.gitignore` で除外する。
- `clasp push`（GAS への反映）と `git push`（GitHub への反映）は別物。コード変更時は両方を行う。

## 初期セットアップ（リモート未作成のため）

まだ GitHub リモートが無いため、初回は以下を実施する:

```bash
# Git リポジトリを初期化
git init

# .gitignore を作成（認証情報などを除外）
# 例: .clasprc.json, node_modules/, *.log

# GitHub にリポジトリを作成して紐付け（gh CLI を使う場合）
gh repo create gas_scripts --private --source=. --remote=origin

# 初回コミット & プッシュ
git add -A
git commit -m "Initial commit"
git push -u origin main
```

### .gitignore 推奨内容

```
node_modules/
.clasprc.json
*.log
.DS_Store
```

## 注意事項

- GAS には実行環境特有の制約（実行時間の上限、トリガー、サービスの呼び出し制限など）がある。新しい API を使う際は GAS で利用可能か確認する。
- スクリプトのテストは GAS エディタ上での実行、または `clasp run` を利用する。
