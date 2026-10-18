(function(root) {
  const config = root.ChefConfig;
  const rules = root.NoodleRules;
  const RecipeSystem = { ready: item => rules.ready(item, config.workflow) };
  const Workbench = { contains: rules.contains, clamp: rules.clamp };
  const CollisionSystem = {
    valid: (item, objects) => Workbench.contains(item.x, item.y, rules.radius(item)) &&
      !objects.some(other => other !== item && ['bowl', 'water'].includes(other.kind) && rules.overlaps(item, other))
  };

  class GameState {
    constructor() {
      this.objects = [];
      this.customers = [];
      this.completed = 0;
      this.serial = 0;
      this.selected = null;
    }
    create(kind, x, y) {
      const item = { id: ++this.serial, kind, x, y, noodles: 0, sauce: 0 };
      this.objects.push(item);
      return item;
    }
  }

  class DragSystem {
    constructor(state) {
      this.state = state;
      this.drag = null;
    }
    down(x, y) {
      let item = [...this.state.objects].reverse().find(item => Math.hypot(x - item.x, y - item.y) < (item.kind === 'bowl' ? 54 : 29));
      let fresh = false;
      if (!item) {
        const source = config.sources.find(source => x >= source.left && x <= source.right && y >= source.top && y <= source.bottom);
        if (source) {
          item = this.state.create(source.kind, x, y);
          fresh = true;
        }
      }
      if (!item) return false;
      this.state.selected = ['bowl', 'water'].includes(item.kind) ? item.id : null;
      this.drag = { o: item, old: { x: item.x, y: item.y }, dx: item.x - x, dy: item.y - y, fresh };
      return true;
    }
    move(x, y) {
      if (!this.drag) return;
      this.drag.o.x = x + this.drag.dx;
      this.drag.o.y = y + this.drag.dy;
    }
    up(cancel = false) {
      if (!this.drag) return;
      const { o: item, old, fresh } = this.drag;
      this.drag = null;
      if (cancel) {
        if (fresh) this.state.objects = this.state.objects.filter(other => other !== item);
        else Object.assign(item, old);
        return;
      }
      if (['bowl', 'water'].includes(item.kind)) {
        if (item.kind === 'water' && fresh && !Workbench.contains(item.x, item.y, 24)) {
          const free = [360, 450, 540, 630, 720, 810].map(x => ({ x, y: 530 }))
            .find(point => CollisionSystem.valid({ ...item, ...point }, this.state.objects));
          if (free) Object.assign(item, free);
        }
        if (!CollisionSystem.valid(item, this.state.objects)) {
          if (fresh) this.state.objects = this.state.objects.filter(other => other !== item);
          else Object.assign(item, old);
        }
        return;
      }
      const bowl = ['noodles', 'sauce', 'cooked', 'scallions', 'cilantro'].includes(item.kind) &&
        [...this.state.objects].reverse().find(bowl => bowl.kind === 'bowl' && Math.hypot(bowl.x - item.x, bowl.y - item.y) < 48);
      if (bowl) {
        if (['scallions', 'cilantro'].includes(item.kind)) bowl[item.kind] = true;
        else bowl[item.kind === 'cooked' ? 'noodles' : item.kind]++;
        this.state.objects = this.state.objects.filter(other => other !== item);
        this.state.selected = bowl.id;
      } else Object.assign(item, Workbench.clamp(item.x, item.y));
    }
  }

  root.ChefSystems = { GameState, DragSystem, RecipeSystem, Workbench, CollisionSystem };
})(typeof window !== 'undefined' ? window : globalThis);
