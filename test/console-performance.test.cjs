const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Overtime = require('../public/overtime/shared.js');
const source = fs.readFileSync(require.resolve('../public/overtime-console.js'),'utf8');
const renderStatistics = source.match(/function renderStatistics\(\) \{[\s\S]*?\n\}/)[0];

function fixture() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      const element = {hidden:false,textContent:'',disabled:false,writes:0,markup:''};
      Object.defineProperty(element,'innerHTML',{get:()=>element.markup,set:value=>{element.markup=value;element.writes++;}});
      elements.set(id,element);
    }
    return elements.get(id);
  };
  const people = Array.from({length:10000},(_,i)=>({key:'uid:'+i,uid:i+1,user:'观众'+i,added:'60',reduced:'0'}));
  const context = vm.createContext({$,machine:{people,history:[]},peoplePage:0,peopleStamp:'',historyStamp:'',Overtime,formatDuration:Overtime.formatDuration,escapeHtml:value=>String(value)});
  vm.runInContext(renderStatistics,context);
  return {context,$};
}

test('一万观众每页最多渲染100人，翻页可访问全部记录，汇总仍包含全部观众', () => {
  const {context,$} = fixture();
  for (const page of [0,1,99]) {
    context.peoplePage=page; context.renderStatistics();
    assert.equal(($('#overtime-people').innerHTML.match(/<tr>/g)||[]).length,100);
    assert.ok($('#overtime-people').innerHTML.includes('UID '+(page*100+1)));
  }
  assert.equal(context.machine.people.length,10000);
  assert.equal($('#overtime-people-next').disabled,true);
  assert.ok($('#overtime-totals').textContent.includes(Overtime.formatDuration(600000n)));
  assert.ok($('#overtime-people-page').textContent.includes('100 / 100'));
});

test('相同页面不重绘，隐藏页面不渲染，返回后刷新，清空统计修正页码', () => {
  const {context,$} = fixture();
  context.renderStatistics(); context.renderStatistics();
  assert.equal($('#overtime-people').writes,1);
  assert.equal($('#overtime-history').writes,1);
  $('#console-view').hidden=true;
  context.machine.people[0].added='120';
  context.renderStatistics(); assert.equal($('#overtime-people').writes,1);
  $('#console-view').hidden=false;
  context.renderStatistics(); assert.equal($('#overtime-people').writes,2);
  context.peoplePage=99; context.machine.people=[];
  context.renderStatistics();
  assert.equal(context.peoplePage,0);
  assert.equal($('#overtime-people-pages').hidden,true);
  assert.equal($('#overtime-people-prev').disabled,true);
  assert.equal($('#overtime-people-next').disabled,true);
  assert.ok($('#overtime-people').innerHTML.includes('还没有观众'));
});
