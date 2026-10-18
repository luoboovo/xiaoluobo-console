(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.Feeding=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  const WIDTH=1280,HEIGHT=720,MAX_COUNT=100000,MAX_SPRITES=2000;
  const themes=[
    {id:'radish',name:'小萝卜吃吃吃',foods:['/feeding/assets/radish.svg'],consumer:'/feeding/assets/consumer.svg'},
    {id:'mouse_rice',name:'老鼠吃大米',foods:['/feeding/assets/mouse_rice/rice.png'],consumer:'/feeding/assets/mouse_rice/mouse.png'},
    {id:'leaves_bin',name:'落叶进桶',foods:['leaf_green','leaf_yellow','leaf_red'].map(n=>`/feeding/assets/leaves_bin/${n}.png`),consumer:'/feeding/assets/leaves_bin/trash_bin.png'},
    {id:'cat_fish',name:'猫咪吃小鱼',foods:['/feeding/assets/cat_fish/fish.png'],consumer:'/feeding/assets/cat_fish/cat.png'},
    {id:'stars_jar',name:'星星收藏瓶',foods:['/feeding/assets/stars_jar/star.png'],consumer:'/feeding/assets/stars_jar/jar.png'}
  ];
  const operations={add:'增加',subtract:'减少',multiply:'乘以',divide:'除以',clear:'清空',wind:'刮大风',range:'范围拾取'};
  function ruleText(rule){return ({add:`投喂 ${rule.value} 个`,subtract:`减少 ${rule.value} 个`,multiply:`食物 ×${rule.value}`,divide:`食物 ÷${rule.value}`,clear:'清空食物',wind:'刮大风 · 随机增减10%～50%',range:`范围拾取 ${rule.seconds||rule.value} 秒`})[rule.operation];}
  const noise=(id,salt=1)=>{const n=Math.sin(id*12.9898+salt*78.233)*43758.5453;return n-Math.floor(n);};
  const consumerHit=(x,y,consumer,size)=>Math.abs(x-consumer.x)<size*.4&&Math.abs(y-consumer.y)<size*.4;
  return {WIDTH,HEIGHT,MAX_COUNT,MAX_SPRITES,themes,operations,ruleText,noise,consumerHit};
});
