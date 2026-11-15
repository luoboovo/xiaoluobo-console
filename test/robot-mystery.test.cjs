const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LiveRobot } = require('../lib/robot.cjs');
const { ConsoleServices } = require('../lib/services.cjs');
const { mentionOf } = require('../lib/protocol.cjs');

function fakeServices() {
  const s = new EventEmitter();
  Object.assign(s, { platform: 'bilibili', selfUid: 1, state: { account: { loggedIn: true, name: '萝卜机器人' }, live: { status: 'connected' } }, sent: [], sendChat: async text => { s.sent.push(text); } });
  return s;
}
async function makeRobot(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-mystery-'));
  const robot = await new LiveRobot(dir, { services: fakeServices() }).init();
  t.after(async () => { await robot.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await robot.action({ action: 'configure', config: { enabled: true } });
  return robot;
}
const chat = (user, uid, text, extra = {}) => ({ type: 'chat', user, uid, text, ...mentionOf(text, extra.reply), ...extra });

test('机器人穿神秘人皮套：点「回复」机器人（带机器人 UID）就算叫它，不管显示什么名字', async t => {
  const robot = await makeRobot(t);
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '神秘人7f3a', uid: 1 } })), true);
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '别人', uid: 9 } })), false);
  assert.equal(robot.mentioned(chat('观众', 5, '@萝卜机器人 在吗')), true, '照旧认真名');
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '神秘人7f3a', uid: 0 } })), false, '还不知道自己穿着神秘人');
});

test('机器人穿神秘人皮套：看到自己的神秘人弹幕后，记住神秘人名字；@ 神秘人（没带别人 UID）也算叫机器人', async t => {
  const robot = await makeRobot(t);
  robot.remember('大家好呀');
  // 观众照抄机器人的话：不当成机器人的名字。
  robot.receive(chat('复读机', 5, '大家好呀'));
  assert.equal(robot.names().includes('复读机'), false);
  // 机器人自己的弹幕回来了：神秘人、没有 UID。
  robot.receive(chat('神秘人7f3a', 0, '大家好呀', { mystery: true }));
  assert.ok(robot.names().includes('神秘人7f3a'));
  assert.equal(robot.mysteryMode, true);
  assert.equal(robot.mentioned(chat('观众', 5, '@神秘人7f3a 今天吃什么')), true, '手打 @');
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '神秘人7f3a', uid: 0 } })), true, '点回复');
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '神秘人', uid: 0 } })), true, 'B站只给「神秘人」也认');
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '神秘人b2c1', uid: 77 } })), false, '回复的是别的（有 UID 的）人');
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '路人', uid: 0 } })), false);

  robot.reset();
  assert.equal(robot.mysteryMode, false, '换平台就忘掉');
});

test('机器人穿神秘人皮套：「其他触发昵称」里填了神秘人，也按神秘人认', async t => {
  const robot = await makeRobot(t);
  await robot.action({ action: 'configure', config: { names: '神秘人' } });
  assert.equal(robot.mysteryMode, true);
  assert.equal(robot.mentioned(chat('观众', 5, '在吗', { reply: { name: '神秘人9e8d', uid: 0 } })), true);
});

test('B站弹幕：穿神秘人皮套的人发的弹幕带上 mystery 标记', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-mystery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const s = await new ConsoleServices({ dataDir: dir, seedDir: dir }).init();
  const events = []; s.on('event', e => events.push(e));
  s.liveMessage({ cmd: 'DANMU_MSG', info: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, { user: { base: { name: '神秘人7f3a', is_mystery: true } }, extra: JSON.stringify({ reply_uname: '萝卜机器人', reply_mid: 1 }) }], '你好', [0, '神秘人7f3a', 0]] });
  s.liveMessage({ cmd: 'DANMU_MSG', info: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, { user: { base: { name: '普通人' } } }], '你好', [5, '普通人', 0]] });
  assert.deepEqual(events.map(e => [e.user, e.mystery, e.mention]), [['神秘人7f3a', true, { name: '萝卜机器人', uid: 1 }], ['普通人', undefined, undefined]]);
  s.close();
});
