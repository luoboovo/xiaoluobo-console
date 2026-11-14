const { EventEmitter } = require('node:events');
const { ConsoleServices } = require('./services.cjs');

// 机器人用的「另一个 B站直播间」连接：只接弹幕、礼物、进场这些消息，发弹幕、点赞、读表情。
// 连接和消息解析直接用控制台主连接的同一套代码（下面借用的方法），
// 登录账号、buvid、WBI 签名、礼物库都和控制台共用，不另外登录。
const SHARED_METHODS = ['connectLive', 'scheduleReconnect', 'disconnectLive', 'liveMessage', 'interact', 'addGift', 'addEvent', 'sendChat', 'likeRoom', 'emoticons', 'publish'];

class RoomLink extends EventEmitter {
  constructor(services, room = '') {
    super();
    const link = this;
    this.services = services;
    this.events = []; this.liveGeneration = 0; this.retryDelay = 3000;
    this.state = {
      live: { status: 'disconnected', roomId: null, title: '', liveStatus: 0 },
      stats: { chat: 0, gift: 0, people: 0 },
      config: { platform: 'bilibili', room: String(room || '') },
      get account() { return link.services.platform === 'bilibili' ? link.services.state.account : link.services.biliAccount || { loggedIn: false, name: '' }; },
    };
  }
  get platform() { return 'bilibili'; }
  get secretData() { return this.services.secretData; }
  get selfUid() { return this.services.selfUid; }
  get buvid() { return this.services.buvid; }
  get wbi() { return this.services.wbi; }
  get WebSocket() { return this.services.WebSocket; }
  get postRequest() { return this.services.postRequest; }
  get diagnostics() { return this.services.diagnostics; }
  get gifts() { return this.services.biliGifts || this.services.gifts; }
  get biliGifts() { return this.gifts; }
  api(...args) { return this.services.api(...args); }
  danmuInfo(id) { return this.services.danmuInfo(id); }
  // 这个直播间的房间号记在机器人直播间列表里，不改控制台的。
  async rememberRoom(input) { this.state.config.room = String(input); }
  giftPriceOf(giftId) { return this.services.giftPriceOf(giftId, this.state.live.roomId, 'bilibili'); }
  // 盲盒补录读的是登录账号自己的礼物流水，和直播间无关。
  giftStream(...args) { return this.services.giftStream(...args); }
  searchUsers(keyword) { return this.services.searchUsers(keyword); }
  close() { this.disconnectLive(false); }
}
for (const name of SHARED_METHODS) RoomLink.prototype[name] = ConsoleServices.prototype[name];

module.exports = { RoomLink };
