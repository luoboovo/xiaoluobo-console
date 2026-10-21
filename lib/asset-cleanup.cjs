const fs=require('node:fs/promises'),path=require('node:path');
const {cacheKey}=require('./render-images.cjs');

const ASSET='[a-f0-9]{64}\\.(?:png|jpg|gif|webp|bmp|wav|mp3|ogg|m4a|mp4|webm)';
const FOLDERS=['overtime-media','feeding-assets'];

// 素材按内容哈希命名，状态里出现过的文件名就算在用。只读内存里的状态：
// Windows 上读取存档文件的同时保存会失败，礼物结算会因此丢失。
function assetNames(...states) {
  return new Set(JSON.stringify(states,(_key,value)=>typeof value==='bigint'?'':value).match(new RegExp(ASSET,'g')));
}

// 删除没有被引用的上传素材。刚上传还没保存的素材在 graceMs 内保留。
async function pruneAssets(dir,used,{graceMs=60*60*1000,now=Date.now()}={}) {
  const name=new RegExp('^'+ASSET+'$'),upload=/^[0-9a-f-]{36}\.tmp$/;
  let removed=0,bytes=0;
  for(const folder of FOLDERS) {
    const base=path.join(dir,folder);
    for(const entry of await fs.readdir(base,{withFileTypes:true}).catch(()=>[])) {
      if(!entry.isFile()||!(name.test(entry.name)||upload.test(entry.name))||used.has(entry.name))continue;
      const file=path.join(base,entry.name),stat=await fs.stat(file).catch(()=>null);
      if(!stat||now-stat.mtimeMs<graceMs)continue;
      // 正在播放而被占用的文件留到下次再删。
      try{await fs.rm(file);}catch{continue;}
      removed++;bytes+=stat.size;
      if(folder==='feeding-assets')for(const thumb of await fs.readdir(path.join(base,'.render')).catch(()=>[]))
        if(thumb.startsWith(cacheKey(file,128)+'_'))await fs.rm(path.join(base,'.render',thumb),{force:true}).catch(()=>{});
    }
  }
  return {removed,bytes};
}

module.exports={pruneAssets,assetNames};
