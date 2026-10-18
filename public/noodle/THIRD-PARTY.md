# 操作逻辑来源

按用户指定，基于 [luoboovo/DanmakuChef](https://github.com/luoboovo/DanmakuChef) 的 `web/config.js` 与 `web/systems.js`，保存为 `static/chef-config.js`、`static/chef-systems.js`。来源提交：`8ca443d818b29e03ea266a14c5f49cfbcae28a8f`。

保留其空碗/面条/肉酱拖拽、自由工作台、重新拾取、重复加料、多碗独立状态、整碗移动、碰撞回退、取消拖拽与配方判断。`test_chef.cjs` 是该项目的核心回归，随单桌布局调整取料区、台面范围和断言。

本面馆继续使用原 B 站弹幕小游戏的监听与礼物目录。网页美术与控制台沿用这次面馆实现，料理台、锅、肉酱盒和成品图片来自用户提供的素材。新增的六张碗与单份食材素材由内置 ImageGen 生成。

本地调整：取料命中区随美术位置更新；移除原 FIFO 出餐方法，由服务器按碗 ID 与顾客订单 ID 精确喂食。保留原拖拽与配方核心。

集成到小萝卜游戏控制台时，将背景、桌台、顾客拆为独立图层，复用游戏素材及拖拽核心；游戏状态由 Node.js 本机服务维护，B 站礼物与账号连接使用控制台现有服务。移除了前端重复的礼物适配器与闲置图标，并把周期轮询改为 SSE 推送。原面馆项目及其私有配置保持原样。

桌台中央新增的 `assets/bowl-area.png` 竹木放碗托盘由内置 ImageGen 工具生成，透明背景，不含文字。

新增的 `assets/trash-bin.png`、`assets/throw-leaf.png`、`assets/throw-egg.png`、`assets/egg-splat.png` 分别为垃圾桶、菜叶、鸡蛋与鸡蛋命中效果，由内置 ImageGen 分别生成，保留透明通道。生成提示词保存在项目 `artifacts/垃圾桶与投掷素材生成说明.md`。

新增的 `assets/water-fridge.png`、`assets/mineral-water.png`、`assets/payment-coin.png`、`assets/chef-body.png`、`assets/chef-hand.png` 为圣水冰柜、圣水瓶、付款金币、厨师身体与小手，由内置 ImageGen 生成或编辑，保留透明通道。提示词记录在 `artifacts/圣水与厨师素材说明.md`。`assets/cash-box.png` 使用用户提供的红色钱匣原图，没有重新生成。
