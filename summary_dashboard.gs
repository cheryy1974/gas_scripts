/**
 * 売上データの月次集計ダッシュボード
 *
 * 「売上データ」シートを読み込み、月ごとに合計売上と件数を集計して
 * 「月次サマリー」シートへ書き出し、月次推移を棒グラフで可視化する。
 * 毎朝9時の自動実行トリガーを登録する関数も含む。
 */

// ===== 設定値（シート名・列の定義） =====
var DATA_SHEET_NAME = '売上データ';     // 入力元シート名
var SUMMARY_SHEET_NAME = '月次サマリー'; // 出力先シート名

// 「売上データ」シートの列番号（1始まり）
var COL_DATE = 1;   // A列：日付
var COL_PERSON = 2; // B列：担当者名
var COL_PRODUCT = 3; // C列：商品名
var COL_AMOUNT = 4; // D列：金額

/**
 * メイン処理。
 * 売上データを月次集計し、サマリーシートへ書き出して棒グラフを作成する。
 * トリガーから毎朝9時に呼び出される。
 */
function generateMonthlySummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = ss.getSheetByName(DATA_SHEET_NAME);

  // 入力シートが存在しない場合はエラーを出して中断する
  if (!dataSheet) {
    throw new Error('「' + DATA_SHEET_NAME + '」シートが見つかりません。');
  }

  // 月ごとに集計する
  var monthlyData = aggregateByMonth(dataSheet);

  // サマリーシートへ書き出す
  var summarySheet = writeSummarySheet(ss, monthlyData);

  // 棒グラフを作成（既存のグラフは削除してから作り直す）
  createBarChart(summarySheet, monthlyData.length);
}

/**
 * 「売上データ」シートを月ごとに集計する。
 *
 * @param {Sheet} dataSheet 売上データシート
 * @return {Array} [{month: '2026年1月', total: 合計売上, count: 件数}, ...]
 *                 月の昇順でソート済み
 */
function aggregateByMonth(dataSheet) {
  var lastRow = dataSheet.getLastRow();

  // ヘッダー行（1行目）のみ、またはデータが無い場合は空配列を返す
  if (lastRow < 2) {
    return [];
  }

  // 2行目から最終行まで、A〜D列を一括取得する
  var values = dataSheet.getRange(2, 1, lastRow - 1, COL_AMOUNT).getValues();

  // 月キー（例：'2026-01'）をキーにして合計と件数を集める
  var map = {};

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var dateValue = row[COL_DATE - 1];
    var amount = row[COL_AMOUNT - 1];

    // 日付が空、または日付として解釈できない行はスキップする
    var date = parseDate(dateValue);
    if (!date) {
      continue;
    }

    // 金額が数値でない行はスキップする
    if (typeof amount !== 'number' || isNaN(amount)) {
      continue;
    }

    // 月キー（ソート用）と表示用ラベルを作る
    var year = date.getFullYear();
    var month = date.getMonth() + 1; // 0始まりなので+1
    var sortKey = year + '-' + ('0' + month).slice(-2); // 例：'2026-01'
    var label = year + '年' + month + '月';             // 例：'2026年1月'

    if (!map[sortKey]) {
      map[sortKey] = { month: label, total: 0, count: 0 };
    }
    map[sortKey].total += amount;
    map[sortKey].count += 1;
  }

  // 月キーで昇順ソートして配列に変換する
  var keys = Object.keys(map).sort();
  var result = [];
  for (var k = 0; k < keys.length; k++) {
    result.push(map[keys[k]]);
  }
  return result;
}

/**
 * 日付セルの値を Date オブジェクトに変換する。
 * Date型・文字列（例：'2026/01/05'）の両方に対応する。
 *
 * @param {*} value セルの値
 * @return {Date|null} 変換できなければ null
 */
function parseDate(value) {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * 「月次サマリー」シートをクリアして集計結果を書き込む。
 * シートが無ければ新規作成する。
 *
 * @param {Spreadsheet} ss スプレッドシート
 * @param {Array} monthlyData aggregateByMonth の戻り値
 * @return {Sheet} 月次サマリーシート
 */
function writeSummarySheet(ss, monthlyData) {
  var summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);

  // 無ければ作成、あれば毎回クリアして書き直す
  if (!summarySheet) {
    summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  } else {
    summarySheet.clear();
  }

  // ヘッダー行を書き込む（A列：月、B列：合計売上、C列：件数）
  var rows = [['月', '合計売上', '件数']];

  // 集計結果を1行ずつ追加する
  for (var i = 0; i < monthlyData.length; i++) {
    rows.push([
      monthlyData[i].month,
      monthlyData[i].total,
      monthlyData[i].count
    ]);
  }

  // 一括書き込み（行数 × 3列）
  summarySheet.getRange(1, 1, rows.length, 3).setValues(rows);

  // ヘッダーを太字にし、列幅を整える
  summarySheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  summarySheet.autoResizeColumns(1, 3);

  return summarySheet;
}

/**
 * 月次サマリーを基に棒グラフを作成する。
 * 既存のグラフはすべて削除してから作り直す。
 *
 * @param {Sheet} summarySheet 月次サマリーシート
 * @param {number} dataCount データ件数（ヘッダーを除く月数）
 */
function createBarChart(summarySheet, dataCount) {
  // 既存のグラフをすべて削除する
  var charts = summarySheet.getCharts();
  for (var i = 0; i < charts.length; i++) {
    summarySheet.removeChart(charts[i]);
  }

  // データが無ければグラフは作らない
  if (dataCount < 1) {
    return;
  }

  // A列（月ラベル）とB列（合計売上）を範囲指定する（ヘッダー含む）
  var range = summarySheet.getRange(1, 1, dataCount + 1, 2);

  // 棒グラフを作成してシートに挿入する
  var chart = summarySheet.newChart()
    .setChartType(Charts.ChartType.COLUMN) // 縦棒グラフ
    .addRange(range)
    .setPosition(2, 5, 0, 0) // E列あたりに配置（2行目, 5列目を起点）
    .setOption('title', '月次売上推移')
    .setOption('legend', { position: 'none' })
    .setOption('hAxis', { title: '月' })
    .setOption('vAxis', { title: '合計売上' })
    .build();

  summarySheet.insertChart(chart);
}

/**
 * 毎朝9時に generateMonthlySummary を自動実行するトリガーを登録する。
 *
 * この関数をGASエディタで一度だけ実行すると、以降は毎朝9時に
 * 集計処理が自動で走るようになる。
 * 重複登録を防ぐため、既存の同名トリガーは削除してから作り直す。
 */
function setupDailyTrigger() {
  // 既存の generateMonthlySummary 向けトリガーを削除する
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'generateMonthlySummary') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 毎日9時台（9:00〜9:59のいずれか）に実行するトリガーを新規登録する
  ScriptApp.newTrigger('generateMonthlySummary')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  // 確認用ログ
  Logger.log('毎朝9時の自動実行トリガーを登録しました。');
}
