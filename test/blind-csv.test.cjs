const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { toCsv, parseCsv } = require('../lib/blind-csv.cjs');
const { LiveRobot } = require('../lib/robot.cjs');

const tempDir = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const remove = dir => fs.rm(dir, { recursive: true, force: true });

test('盲盒 CSV：导出带 BOM 和表头，长 UID 写成 Excel 不会改坏的格式，昵称防公式', () => {
  const csv = toCsv([
    { key: 'uid:3546789012345678', name: '甲', count: 3, cost: 45000, value: 30500, today: { count: 1, cost: 15000, value: 5200 }, updated_at: new Date(2026, 10, 16, 20, 5).getTime() },
    { key: 'name:=乙,"丙"', name: '=乙,"丙"', count: 1, cost: 15000, value: 20000, today: null, updated_at: 0 },
  ]);
  assert.ok(csv.startsWith('﻿UID,昵称,盲盒个数,投入(元),开出(元),盈亏(元),今天个数,今天投入(元),今天开出(元),最后更新\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], '="3546789012345678",甲,3,45.00,30.50,-14.50,1,15.00,5.20,2026-11-16 20:05');
  assert.equal(lines[2], ',"\t=乙,""丙""",1,15.00,20.00,5.00,0,0.00,0.00,');
  const back = parseCsv(csv);
  assert.deepEqual(back.map(r => [r.key, r.name, r.count, r.cost, r.value, r.today]), [
    ['uid:3546789012345678', '甲', 3, 45000, 30500, { count: 1, cost: 15000, value: 5200 }],
    ['name:=乙,"丙"', '=乙,"丙"', 1, 15000, 20000, { count: 0, cost: 0, value: 0 }],
  ], '导出再导入原样回来');
  assert.equal(back[0].updated_at, new Date(2026, 10, 16, 20, 5).getTime());
});

test('盲盒 CSV：Excel 改过的格式也能读（纯数字 UID、¥、少几列、空行、全 0 行跳过）', () => {
  const rows = parseCsv('昵称,UID,盲盒个数,投入,开出\n甲,123,2,¥30,12.5\n\n乙,,1,15,0\n丙,456,0,0,0\n');
  assert.deepEqual(rows.map(r => [r.key, r.count, r.cost, r.value]), [['uid:123', 2, 30000, 12500], ['name:乙', 1, 15000, 0]]);
});

test('盲盒 CSV：有错就整份不导入，写明第几行', () => {
  assert.throws(() => parseCsv('UID,昵称,盲盒个数,投入(元),开出(元)\n3.54679E+15,甲,1,15,0\n'), /第 2 行：UID「3\.54679E\+15」被表格软件改成了科学计数法/);
  assert.throws(() => parseCsv('UID,昵称,盲盒个数,投入(元),开出(元)\n1,甲,1.5,15,0\n2,乙,1,abc,0\n'), /第 2 行：盲盒个数「1\.5」要填整数；第 3 行：投入「abc」不是有效的金额。没有导入任何记录/);
  assert.throws(() => parseCsv('UID,昵称,盲盒个数,投入(元),开出(元)\n1,甲,1,15,0\n1,甲改名,2,30,0\n'), /第 3 行：和第 2 行是同一位观众/);
  assert.throws(() => parseCsv('UID,昵称,盲盒个数,投入(元),开出(元),今天个数\n1,甲,1,15,0,2\n'), /今天.*不能比总数还大/);
  assert.throws(() => parseCsv('UID,昵称,盲盒个数,投入(元),开出(元)\n,,1,15,0\n'), /UID 和昵称至少填一个/);
  assert.throws(() => parseCsv('名字,数量\n甲,1\n'), /找不到表头/);
  assert.throws(() => parseCsv('UID,昵称,盲盒个数,开出(元)\n1,甲,1,0\n'), /缺少「投入\(元\)」/);
});

test('机器人盲盒记录：导出包含补录的数，改完导入覆盖当前平台全部记录，之后不能再补录，清空后可以', async t => {
  const dir = await tempDir('luobo-blind-csv-');
  const services = new EventEmitter();
  Object.assign(services, { platform: 'bilibili', selfUid: 1, state: { account: { loggedIn: true }, live: { status: 'connected' } }, gifts: [{ id: 10, name: '小花花', price: 100 }, { id: 11, name: '心动盲盒', price: 15000 }], sendChat: async () => {} });
  let now = new Date(2026, 10, 16, 20, 0).getTime();
  const robot = await new LiveRobot(dir, { services, now: () => now }).init();
  t.after(async () => { await robot.close(); await remove(dir); });
  const box = (user, uid, giftName, price) => robot.receive({ type: 'gift', user, uid, giftId: 10, giftName, giftPrice: price, count: 1, blindGiftName: '心动盲盒', blindGiftPrice: 15000, transactionId: user + now++ });
  box('甲', 2, '小花花', 100); box('甲', 2, '小花花', 100); box('乙', 3, '小花花', 100);
  // 假装补录过一位老观众
  robot.blind.imported.bilibili = { 'uid:9': { name: '老观众', count: 4, cost: 60000, value: 80000, days: {}, recent: [], updated_at: 1 } };
  robot.blindVersion++;
  const csv = robot.exportBlindCsv();
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(csv, /="2",甲,2,30\.00,0\.20,-29\.80,2,30\.00,0\.20,/);
  assert.match(csv, /="9",老观众,4,60\.00,80\.00,20\.00,0/);
  // 手动改：甲的个数改成 5，删掉乙，加一个只知道昵称的丙
  const edited = [lines[0], '="2",甲,5,75.00,10.00,,1,15.00,0.10,', '="9",老观众,4,60.00,80.00,,0,0,0,', ',丙,1,15.00,52.00,,1,15.00,52.00,'].join('\n');
  const result = await robot.importBlindCsv(edited);
  assert.deepEqual([result.users, result.before], [3, 3]);
  const list = robot.snapshot().blindbox, by = name => list.find(r => r.name === name);
  assert.equal(list.length, 3); assert.equal(by('乙'), undefined, '删掉的行就删掉了这位观众');
  assert.deepEqual([by('甲').count, by('甲').cost, by('甲').value, by('甲').today], [5, 75000, 10000, { count: 1, cost: 15000, value: 100 }]);
  assert.equal(by('甲').recent.length, 2, '最近明细沿用原来的');
  assert.equal(by('老观众').count, 4, '补录的数合进去了，不会算两遍');
  assert.equal(robot.blind.imported.bilibili, undefined);
  assert.equal(robot.blindReply({ user: '丙', uid: 0 }), '丙今天开了1个盲盒，赚了37元；累计1个，投入15元，开出52元，赚了37元');
  assert.equal(robot.snapshot().blind_csv.users, 3);
  assert.throws(() => robot.startImport(30), /从 CSV 导入的.*请先清空记录/);
  // 之后新开的盲盒照常累加
  box('甲', 2, '小花花', 100);
  assert.equal(robot.snapshot().blindbox.find(r => r.name === '甲').count, 6);
  // 文件里也存下来了
  await robot.writeBlind();
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'robot-blindbox.json'), 'utf8'));
  assert.equal(saved.platforms.bilibili['uid:2'].count, 6); assert.equal(saved.csv_imported.bilibili.users, 3);
  // 有错的 CSV 不动现有记录
  await assert.rejects(robot.importBlindCsv('UID,昵称,盲盒个数,投入(元),开出(元)\n1,甲,x,15,0\n'), /第 2 行/);
  assert.equal(robot.snapshot().blindbox.length, 3);
  await robot.action({ action: 'clear_blindbox' });
  assert.equal(robot.snapshot().blind_csv, null, '清空后可以重新补录');
});
