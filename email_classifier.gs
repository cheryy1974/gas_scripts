/**
 * Gmail メール自動分類スクリプト
 *
 * 「要処理」ラベルの未読メールを取得し、Claude API で
 * 「クレーム」「質問」「注文」「その他」に分類・要約する。
 * 結果をスプレッドシートの「メールログ」シートに記録し、
 * Slack で担当者に通知したうえで、メールに「処理済み」ラベルを付けて
 * 「要処理」ラベルを外す。5分おきの自動実行トリガーも登録できる。
 *
 * 事前準備（スクリプトプロパティに登録）:
 *   CLAUDE_API_KEY    … Claude API キー
 *   SLACK_WEBHOOK_URL … Slack Incoming Webhook の URL
 */

// ===== 設定値 =====
var TARGET_LABEL_NAME = '要処理';   // 処理対象メールのラベル名
var DONE_LABEL_NAME = '処理済み';   // 処理完了後に付けるラベル名
var LOG_SHEET_NAME = 'メールログ';   // 分類結果の記録先シート名
var ERROR_SHEET_NAME = 'エラーログ'; // エラー記録先シート名

// Claude API 設定
var CLAUDE_MODEL = 'claude-haiku-4-5'; // コストを抑えるため最新の Haiku を使用
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_VERSION = '2023-06-01';

// 分類カテゴリ（Claude にこの中から1つ選ばせる）
var CATEGORIES = ['クレーム', '質問', '注文', 'その他'];

// メール本文が長すぎる場合に切り詰める文字数（トークン量・コスト対策）
var MAX_BODY_LENGTH = 5000;

/**
 * メイン処理。トリガーから5分おきに呼び出される。
 * 「要処理」ラベルの未読メールを分類・記録・通知し、ラベルを付け替える。
 */
function processLabeledEmails() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('CLAUDE_API_KEY');
  var webhookUrl = props.getProperty('SLACK_WEBHOOK_URL');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = getOrCreateSheet(ss, LOG_SHEET_NAME,
    ['受信日時', '送信者', '件名', '分類', '要約']);
  var errorSheet = getOrCreateSheet(ss, ERROR_SHEET_NAME,
    ['発生日時', '対象', 'エラー内容']);

  // 必須プロパティが無ければエラー記録して中断する
  if (!apiKey) {
    logError(errorSheet, '全体', 'スクリプトプロパティ CLAUDE_API_KEY が未設定です。');
    return;
  }

  var targetLabel = GmailApp.getUserLabelByName(TARGET_LABEL_NAME);
  if (!targetLabel) {
    logError(errorSheet, '全体', '「' + TARGET_LABEL_NAME + '」ラベルが見つかりません。');
    return;
  }
  // 「処理済み」ラベルは無ければ作成する
  var doneLabel = getOrCreateLabel(DONE_LABEL_NAME);

  // 対象ラベルが付いたスレッドを取得して処理する
  var threads = targetLabel.getThreads();
  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var threadHadError = false;

    try {
      var messages = thread.getMessages();
      for (var j = 0; j < messages.length; j++) {
        var msg = messages[j];

        // 未読メールのみを対象とする
        if (!msg.isUnread()) {
          continue;
        }

        try {
          // 1. Claude API で分類・要約する
          var result = classifyEmail(apiKey, msg.getPlainBody());

          // 2. メールログシートに記録する（受信日時・送信者・件名・分類・要約）
          logSheet.appendRow([
            msg.getDate(),
            msg.getFrom(),
            msg.getSubject(),
            result.category,
            result.summary
          ]);

          // 3. Slack に通知する
          notifySlack(webhookUrl, msg.getSubject(), result.category, result.summary);

          // 4. このメールを既読にする
          msg.markRead();

        } catch (eMsg) {
          // メール単位のエラーは記録して次のメールへ進む
          logError(errorSheet, '件名: ' + safeText(msg.getSubject()), errorMessage(eMsg));
          threadHadError = true;
        }
      }

      // スレッド内の未読メールをすべて処理できた場合のみラベルを付け替える。
      // エラーがあった場合は次回の実行で再試行できるよう「要処理」を残す。
      if (!threadHadError) {
        thread.addLabel(doneLabel);
        thread.removeLabel(targetLabel);
      }

    } catch (eThread) {
      logError(errorSheet, 'スレッド処理', errorMessage(eThread));
    }
  }
}

/**
 * メール本文を Claude API に送り、分類カテゴリと要約を取得する。
 *
 * @param {string} apiKey Claude API キー
 * @param {string} body メール本文（プレーンテキスト）
 * @return {{category: string, summary: string}} 分類結果
 */
function classifyEmail(apiKey, body) {
  // 本文が長すぎる場合は先頭のみ使用する（コスト・トークン量対策）
  var trimmedBody = body ? body.substring(0, MAX_BODY_LENGTH) : '';

  // 出力を確実に JSON で受け取るため、構造化出力スキーマを指定する
  var schema = {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: CATEGORIES // この4つから必ず1つを選ばせる
      },
      summary: {
        type: 'string'
      }
    },
    required: ['category', 'summary'],
    additionalProperties: false
  };

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: 'あなたはカスタマーサポートのメールを分類するアシスタントです。'
      + 'メール本文を読み、内容を「クレーム」「質問」「注文」「その他」のいずれかに分類し、'
      + '日本語で1〜2文の簡潔な要約を作成してください。',
    messages: [
      {
        role: 'user',
        content: '以下のメールを分類・要約してください。\n\n--- メール本文 ---\n' + trimmedBody
      }
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: schema
      }
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // エラー時もレスポンス本文を取得して詳細を残す
  };

  var response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  var statusCode = response.getResponseCode();
  var responseText = response.getContentText();

  // HTTP ステータスが 200 以外なら本文付きでエラーを投げる
  if (statusCode !== 200) {
    throw new Error('Claude API エラー (HTTP ' + statusCode + '): ' + responseText);
  }

  // レスポンスから JSON 文字列（text ブロック）を取り出してパースする
  var json = JSON.parse(responseText);
  var textBlock = null;
  for (var k = 0; k < json.content.length; k++) {
    if (json.content[k].type === 'text') {
      textBlock = json.content[k].text;
      break;
    }
  }
  if (!textBlock) {
    throw new Error('Claude API レスポンスに text ブロックがありません: ' + responseText);
  }

  var parsed = JSON.parse(textBlock);
  return {
    category: parsed.category,
    summary: parsed.summary
  };
}

/**
 * Slack の Incoming Webhook に通知を送る。
 *
 * @param {string} webhookUrl Slack Webhook URL
 * @param {string} subject メール件名
 * @param {string} category 分類カテゴリ
 * @param {string} summary 要約
 */
function notifySlack(webhookUrl, subject, category, summary) {
  // Webhook URL 未設定の場合は通知をスキップする
  if (!webhookUrl) {
    return;
  }

  var text = '【新着メール分類】\n'
    + '件名: ' + safeText(subject) + '\n'
    + '分類: ' + category + '\n'
    + '要約: ' + summary;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(webhookUrl, options);
  var code = response.getResponseCode();
  // Slack は成功時に 200 と "ok" を返す
  if (code !== 200) {
    throw new Error('Slack 通知エラー (HTTP ' + code + '): ' + response.getContentText());
  }
}

/**
 * 指定名のシートを取得する。無ければ作成し、ヘッダー行を書き込む。
 *
 * @param {Spreadsheet} ss スプレッドシート
 * @param {string} name シート名
 * @param {Array<string>} headers ヘッダー行
 * @return {Sheet} シート
 */
function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

/**
 * 指定名の Gmail ラベルを取得する。無ければ作成する。
 *
 * @param {string} name ラベル名
 * @return {GmailLabel} ラベル
 */
function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

/**
 * エラーログシートにエラー内容を1行追記する。
 *
 * @param {Sheet} errorSheet エラーログシート
 * @param {string} target 対象（件名やフェーズなど）
 * @param {string} message エラー内容
 */
function logError(errorSheet, target, message) {
  errorSheet.appendRow([new Date(), target, message]);
}

/**
 * 例外オブジェクトから安全にメッセージ文字列を取り出す。
 *
 * @param {*} e 例外
 * @return {string} メッセージ
 */
function errorMessage(e) {
  if (e && e.message) {
    return e.message;
  }
  return String(e);
}

/**
 * null/undefined を空文字に変換する補助関数。
 *
 * @param {*} value 値
 * @return {string} 文字列
 */
function safeText(value) {
  return value == null ? '' : String(value);
}

/**
 * 5分おきに processLabeledEmails を自動実行するトリガーを登録する。
 *
 * この関数を GAS エディタで一度だけ実行すると、以降は5分ごとに
 * メールの分類処理が自動で走るようになる。
 * 重複登録を防ぐため、既存の同名トリガーは削除してから作り直す。
 */
function setupEmailTrigger() {
  // 既存の processLabeledEmails 向けトリガーを削除する
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processLabeledEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 5分おきに実行するトリガーを新規登録する
  ScriptApp.newTrigger('processLabeledEmails')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('5分おきの自動実行トリガーを登録しました。');
}
