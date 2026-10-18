(function(root) {
  const defaults = { top: '小萝卜的', title: '弹 幕 面 馆', bottom: '一份心意 · 一碗好面' };
  const limits = { top: 24, title: 16, bottom: 32 };
  function validate(input = defaults) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('招牌文字无效');
    const result = {};
    for (const [key, limit] of Object.entries(limits)) {
      if (typeof input[key] !== 'string' || input[key].length > limit || /[\r\n]/.test(input[key])) throw new Error('招牌文字过长或格式无效');
      result[key] = input[key].trim();
    }
    return result;
  }
  const api = { defaults, validate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoodleSign = api;
})(globalThis);
