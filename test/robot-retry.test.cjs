const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LiveRobot } = require('../lib/robot.cjs');

const tempDir = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const remove = dir => fs.rm(dir, { recursive: true, force: true });
const flush = () => new Promise(resolve => setImmediate(resolve));

function fakeServices(sendChat) {
  const services = new EventEmitter();
  Object.assign(services, { platform: 'bilibili', selfUid: 1, state: { account: { loggedIn: true, name: '萝卜机器人' }, live: { status: 'connected' } }, gifts: [], sent: [] });
  services.sendChat = sendChat || (async (text, options) => { services.sent.push({ text, ...options }); });
  return services;
}

async function makeRobot(t, { replies, sendChat, sleep } = {}) {
  const dir = await tempDir('luobo-retry-');
  const calls = [];
  const fetchImpl = async () => {
    const next = replies.shift();
    calls.push(next);
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({ error: { message: '服务器繁忙' } }) };
    if (next instanceof Error) throw next;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: next } }] }) };
  };
  const services = fakeServices(sendChat);
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => 'sk-test', set: async () => {} }, ...(sleep ? { sleep } : { aiRetryMs: 0 }) }).init();
  t.after(async () => { await robot.close(); await remove(dir); });
  return { robot, services, calls };
}

test('AI 出错（报错、超时、返回空）会再问，最多重试 3 次，每次隔得更久一点', async t => {
  const delays = [];
  const { robot, calls } = await makeRobot(t, { replies: [500, new Error('offline'), '', '来啦来啦~'], sleep: async ms => { delays.push(ms); } });
  const { reply } = await robot.ask('观众甲', '在吗');
  assert.equal(reply, '来啦来啦','第 4 次问成功就用 AI 的话');
  assert.equal(calls.length, 4);
  assert.deepEqual(delays, [1500, 3000, 4500]);
});

test('AI 重试 3 次还不行才放弃（错误里写明重试过）；Key 不对、没余额这类错误不重试', async t => {
  const { robot, calls } = await makeRobot(t, { replies: [500, 500, 500, 500, 500, 401, 402] });
  await assert.rejects(robot.ask('观众甲', '在吗'), /服务器繁忙（已重试 3 次）/);
  assert.equal(calls.length, 4, '第一次 + 重试 3 次');
  calls.length = 0;
  await assert.rejects(robot.ask('观众甲', '在吗'), /API Key 无效/);
  assert.equal(calls.length, 2, '500 之后遇到 401 就不再重试');
  await assert.rejects(robot.ask('观众甲', '在吗'), /余额不足/);
  assert.equal(calls.length, 3, '402 一次就放弃');
});

test('AI 重试 3 次都失败：点名改用写好的话术', async t => {
  const { robot } = await makeRobot(t, { replies: [503, 503, 503, 503] });
  await robot.action({ action: 'configure', config: { ai: { enabled: true }, cue: { use_ai: true, templates: '冒个泡嘛' } } });
  assert.equal(await robot.cueText({ name: '甲', key: 'u:2' }, false), '冒个泡嘛');
});

test('弹幕发送失败会重发，最多重试 3 次；被 B站屏蔽的不重发', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-16T12:00:00').getTime() });
  let failures = 2, tries = 0, filtered = false;
  const { robot, services } = await makeRobot(t, { replies: [], sendChat: async (text, options) => {
    tries++;
    if (filtered) { const error = new Error('弹幕被B站屏蔽（含敏感词或重复）'); error.code = 'FILTERED'; throw error; }
    if (failures-- > 0) throw new Error('B站：网络开小差');
    services.sent.push({ text, ...options });
  } });
  const run = async seconds => { for (let i = 0; i < seconds; i++) { t.mock.timers.tick(1000); await flush(); } };
  await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100 } });

  await robot.action({ action: 'say', text: '大家好' });
  await run(15);
  assert.equal(tries, 3, '失败两次，第三次发出去');
  assert.deepEqual(services.sent.map(s => s.text), ['大家好']);
  assert.equal(robot.snapshot().log[0].status, 'sent');

  tries = 0; failures = 99;
  await robot.action({ action: 'say', text: '还在吗' });
  await run(20);
  assert.equal(tries, 4, '第一次 + 重试 3 次');
  assert.equal(robot.snapshot().log[0].status, 'failed');
  assert.match(robot.snapshot().log[0].error, /网络开小差（已重试 3 次）/);

  tries = 0; filtered = true;
  await robot.action({ action: 'say', text: '屏蔽词' });
  await run(10);
  assert.equal(tries, 1, '被屏蔽的重发也没用，不重试');
  assert.equal(robot.snapshot().log[0].status, 'failed');
});
