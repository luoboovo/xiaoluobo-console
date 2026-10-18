(function(root) {
  function pose(pointer, holding = false, item = { x: 0, y: 0, scale: 1 }) {
    const p = pointer || { x: 718 + item.x + 37 * item.scale, y: 285 + item.y + 117 * item.scale };
    const x = Math.max(0, Math.min(1280, p.x)), y = Math.max(0, Math.min(720, p.y));
    const lean = (x - 640) / 640 * 12;
    const shoulder = { x: 718 + item.x + lean * item.scale, y: 285 + item.y };
    const hand = { x: x + (holding ? 12 : 0), y: y + (holding ? 18 : 0) };
    const elbow = { x: shoulder.x + (hand.x - shoulder.x) * .48, y: shoulder.y + (hand.y - shoulder.y) * .48 + Math.min(40, Math.hypot(hand.x - shoulder.x, hand.y - shoulder.y) * .12) };
    const segment = (a, b) => ({ x: a.x, y: a.y, length: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI });
    return { lean, tilt: lean / 6, hand, upper: segment(shoulder, elbow), lower: segment(elbow, hand) };
  }
  if (typeof module !== 'undefined') module.exports = { pose }; else root.NoodleChef = { pose };
})(globalThis);
