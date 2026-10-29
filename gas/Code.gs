/**
 * Puretomo: Google Apps Script から GitHub Actions を5分ごとに起動する。
 *
 * 初回:
 *  1. setGitHubToken を使わず、プロジェクトの「スクリプト プロパティ」に
 *     GITHUB_TOKEN = fine-grained PAT を設定する。
 *     PAT の対象は ogatetsu-0501/pure のみ、Actions: Read and write。
 *  2. installTrigger() を1回実行して許可する。
 *  3. runBazaarUpdate() を手動実行し、実行ログにHTTP 204が出るか確認。
 * トークンをこのソースコードやGitHubへ記述しないこと。
 */

const GITHUB_REPO = 'ogatetsu-0501/pure';
const GITHUB_WORKFLOW = 'update-and-deploy.yml';
const MIN_INTERVAL_MS = 4 * 60 * 1000;

function runBazaarUpdate() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) {
    console.log('別の起動処理が実行中のためスキップ');
    return;
  }
  try {
    const properties = PropertiesService.getScriptProperties();
    const last = Number(properties.getProperty('LAST_DISPATCH_MS') || 0);
    const now = Date.now();
    if (now - last < MIN_INTERVAL_MS) {
      console.log('前回の起動から4分未満のためスキップ');
      return;
    }

    const token = properties.getProperty('GITHUB_TOKEN');
    if (!token) throw new Error('スクリプトプロパティ GITHUB_TOKEN が未設定');

    const endpoint = 'https://api.github.com/repos/' + GITHUB_REPO +
      '/actions/workflows/' + GITHUB_WORKFLOW + '/dispatches';
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'puretomo-gas-scheduler',
      },
      payload: JSON.stringify({ref: 'main'}),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    if (status !== 204) {
      throw new Error('GitHub dispatch HTTP ' + status + ': ' +
        response.getContentText().slice(0, 600));
    }
    properties.setProperty('LAST_DISPATCH_MS', String(now));
    console.log('GitHub Actions起動指示成功: HTTP 204 / ' + new Date(now).toISOString());
  } finally {
    lock.releaseLock();
  }
}

function installTrigger() {
  const handler = 'runBazaarUpdate';
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  console.log('5分トリガー登録完了。正確な分・秒での実行は保証されません。');
}

function removeTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'runBazaarUpdate') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  console.log('5分トリガー停止');
}
