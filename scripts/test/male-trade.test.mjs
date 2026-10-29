// Cookieの実値を使わず、API一覧の統合と異常応答時の保護を確認する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTradeLists } from '../male-trade.mjs';

const response = (rows, maxCount = rows.length) => ({
  status: 'SUCCESS',
  serverTime: '2026-10-29T13:00:00.000Z',
  result: { itemList: rows, maxCount },
});

test('公開・男性一覧を統合し重複コードを1件にする', () => {
  const result = mergeTradeLists(
    response([{ itemCode: 'F1', listingCount: 1 }, { itemCode: 'M1', listingCount: 1 }]),
    response([{ itemCode: 'M1', listingCount: 2 }, { itemCode: 'M2', listingCount: 3 }]),
  );
  assert.deepEqual(result.tradeData.result.itemList.map(x => x.itemCode), ['F1', 'M1', 'M2']);
  assert.equal(result.tradeData.result.itemList[1].listingCount, 2);
  assert.deepEqual([...result.maleCodes], ['M1', 'M2']);
});

test('男性一覧が空なら更新を止める', () => {
  assert.throws(() => mergeTradeLists(response([{ itemCode: 'F1' }]), response([])), /男性一覧が空/);
});

test('男性一覧のページ欠落なら更新を止める', () => {
  assert.throws(() => mergeTradeLists(response([{ itemCode: 'F1' }]), response([{ itemCode: 'M1' }], 2)), /不完全/);
});

test('認証エラー応答なら更新を止める', () => {
  const error = { status: 'ERROR', result: { itemList: [] } };
  assert.throws(() => mergeTradeLists(response([{ itemCode: 'F1' }]), error), /応答が不正/);
});
