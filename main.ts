// Sokoban solver: split the level into hallway + rooms, solve each room
// with a push-optimal A*.
//
// Every generated level is a one-cell-wide hallway (the row the player
// starts on) with one to four rooms hanging off it. Each room holds 3-4
// boxes and as many goals and is entered through a single door. A box
// pushed out of its room into the hallway can never come back, so boxes
// never leave their room and rooms are independent: solve each room on
// its own, in order of increasing door distance from the player, walk the
// hallway between doors, and concatenate the move strings.
//
// Inside a room the search runs over pushes only (A*): a state is the
// player's square plus the sorted box squares, its cost is the number of
// pushes so far, and its estimate is the sum over boxes of the BFS
// distance to the nearest goal. The player walks between pushes by BFS
// with boxes as obstacles. A box in a non-goal corner (a wall on one
// vertical side and a wall on one horizontal side) is dead and pruned.
// The search is bounded by expansions, never by the clock, and every
// tie-break is fixed, so two runs write identical bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Moves in a fixed order: up, down, left, right.
const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
] as const;
const DELTA: Record<string, [number, number]> = {
  u: [0, -1],
  d: [0, 1],
  l: [-1, 0],
  r: [1, 0],
};
const EXPANSION_BUDGET = 400000;

type Level = {
  w: number;
  h: number;
  wall: Uint8Array;
  goal: Uint8Array;
  boxes: number[];
  player: number;
};

type Room = {
  cells: Set<number>;
  boxes: number[];
  goals: number[];
  door: number;
};

function parseLevel(text: string): Level {
  const lines = text.split('\n').filter((r) => r.length > 0);
  const h = lines.length;
  const w = Math.max(...lines.map((r) => r.length));
  const wall = new Uint8Array(w * h);
  const goal = new Uint8Array(w * h);
  const boxes: number[] = [];
  let player = -1;
  lines.forEach((row, y) => {
    const padded = row.padEnd(w, '#');
    for (let x = 0; x < w; x++) {
      const ch = padded[x]!;
      const i = y * w + x;
      wall[i] = ch === '#' ? 1 : 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goal, boxes, player };
}

// A binary heap ordered by (f, deeper first, earliest inserted): fully
// deterministic. Each entry is [f, -g, sequence, node index].
class OpenList {
  private items: [number, number, number, number][] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  private static before(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return (
      a[0] < b[0] ||
      (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
    );
  }

  add(f: number, g: number, node: number): void {
    const entry: [number, number, number, number] = [f, -g, this.seq++, node];
    const heap = this.items;
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!OpenList.before(heap[i]!, heap[parent]!)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
      i = parent;
    }
  }

  take(): number {
    const heap = this.items;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && OpenList.before(heap[left]!, heap[smallest]!)) smallest = left;
        if (right < heap.length && OpenList.before(heap[right]!, heap[smallest]!)) smallest = right;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!];
        i = smallest;
      }
    }
    return top[3];
  }
}

function solveLevel(text: string): string {
  const level = parseLevel(text);
  const { w, h, wall, goal } = level;
  const idx = (x: number, y: number): number => y * w + x;
  const inside = (x: number, y: number): boolean => x >= 0 && x < w && y >= 0 && y < h;
  const isWall = (x: number, y: number): boolean => !inside(x, y) || wall[idx(x, y)] === 1;
  const xy = (c: number): [number, number] => [c % w, Math.floor(c / w)];
  const hallRow = Math.floor(level.player / w);
  const isHall = (c: number): boolean => Math.floor(c / w) === hallRow;

  // ---- Split the floor off the hallway row into connected rooms. ----
  const rooms: Room[] = [];
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = idx(x, y);
      if (wall[start] || y === hallRow || seen[start]) continue;
      const component: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const c = stack.pop()!;
        component.push(c);
        const [cx, cy] = xy(c);
        for (const d of DIRS) {
          const nx = cx + d.dx;
          const ny = cy + d.dy;
          if (!inside(nx, ny) || ny === hallRow) continue;
          const ni = idx(nx, ny);
          if (!wall[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      component.sort((a, b) => a - b);
      const roomBoxes = level.boxes.filter((b) => component.includes(b));
      if (roomBoxes.length === 0) continue;
      const roomGoals = component.filter((c) => goal[c] === 1);
      // Door: the room cell touching a hallway floor cell; smallest index wins.
      let door = -1;
      for (const c of component) {
        const [cx, cy] = xy(c);
        const touchesHall = DIRS.some((d) => {
          const nx = cx + d.dx;
          const ny = cy + d.dy;
          return ny === hallRow && inside(nx, ny) && wall[idx(nx, ny)] === 0;
        });
        if (touchesHall) {
          door = c;
          break;
        }
      }
      if (door < 0) continue;
      rooms.push({ cells: new Set(component), boxes: roomBoxes, goals: roomGoals, door });
    }
  }

  // ---- BFS of the player's walk, boxes as obstacles. ----
  // Returns the move string from `from` to `to`, or null when unreachable.
  // `allowed(c)` restricts the walkable area (anywhere, or room + hallway).
  function walkPath(
    from: number,
    to: number,
    boxSet: Set<number>,
    allowed: (c: number) => boolean,
  ): string | null {
    if (from === to) return '';
    const cameFrom = new Map<number, number>([[from, -1]]);
    const stepUsed = new Map<number, string>();
    const queue = [from];
    let head = 0;
    while (head < queue.length) {
      const c = queue[head++]!;
      const [cx, cy] = xy(c);
      for (const d of DIRS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (!inside(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (wall[ni] || boxSet.has(ni) || !allowed(ni) || cameFrom.has(ni)) continue;
        cameFrom.set(ni, c);
        stepUsed.set(ni, d.ch);
        if (ni === to) {
          let out = '';
          let cur = ni;
          while (cur !== from) {
            out = stepUsed.get(cur)! + out;
            cur = cameFrom.get(cur)!;
          }
          return out;
        }
        queue.push(ni);
      }
    }
    return null;
  }

  // All squares the player can reach from `from` without moving a box,
  // each with the walk string that gets there.
  function reachable(
    from: number,
    boxSet: Set<number>,
    inScope: (c: number) => boolean,
  ): Map<number, string> {
    const found = new Map<number, string>([[from, '']]);
    const queue = [from];
    let head = 0;
    while (head < queue.length) {
      const c = queue[head++]!;
      const [cx, cy] = xy(c);
      for (const d of DIRS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (!inside(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (wall[ni] || boxSet.has(ni) || !inScope(ni) || found.has(ni)) continue;
        found.set(ni, found.get(c)! + d.ch);
        queue.push(ni);
      }
    }
    return found;
  }

  // ---- Push-A* for one room, starting with the player on the hallway. ----
  // Returns the move string and the room boxes' final squares, or null.
  function solveRoom(
    room: Room,
    entryPlayer: number,
    allBoxes: number[],
  ): { moves: string; boxes: number[] } | null {
    const roomCells = room.cells;
    const goalSet = new Set(room.goals);
    const inScope = (c: number): boolean => roomCells.has(c) || isHall(c);
    // BFS distance from every in-scope cell to its nearest room goal.
    const dist = new Map<number, number>();
    const dq: number[] = [];
    for (const g of room.goals) {
      dist.set(g, 0);
      dq.push(g);
    }
    let dqHead = 0;
    while (dqHead < dq.length) {
      const c = dq[dqHead++]!;
      const [cx, cy] = xy(c);
      for (const d of DIRS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (!inside(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (wall[ni] || !inScope(ni) || dist.has(ni)) continue;
        dist.set(ni, dist.get(c)! + 1);
        dq.push(ni);
      }
    }
    const estimate = (bs: number[]): number =>
      bs.reduce((sum, b) => sum + (dist.get(b) ?? 50), 0);
    // A box is dead when it sits in a non-goal corner: a wall on one
    // vertical side and a wall on one horizontal side. (Boxes as blockers
    // are not counted: that would prune solvable positions.)
    const cornerDead = (b: number): boolean => {
      if (goalSet.has(b)) return false;
      const [bx, by] = xy(b);
      const vertical = isWall(bx, by - 1) || isWall(bx, by + 1);
      const horizontal = isWall(bx - 1, by) || isWall(bx + 1, by);
      return vertical && horizontal;
    };

    const startBoxes = allBoxes.filter((b) => roomCells.has(b)).sort((a, b) => a - b);
    const stateKey = (p: number, bs: number[]): string => `${p}|${bs.join(',')}`;

    // A* nodes kept in parallel arrays, linked by parent index.
    const nodePlayer: number[] = [entryPlayer];
    const nodeBoxes: number[][] = [startBoxes];
    const nodeCost: number[] = [0];
    const nodeParent: number[] = [-1];
    const nodeStep: string[] = ['']; // walk + push that produced this node
    const best = new Map<string, number>([[stateKey(entryPlayer, startBoxes), 0]]);
    const open = new OpenList();
    open.add(estimate(startBoxes), 0, 0);

    let expanded = 0;
    while (open.size > 0 && expanded < EXPANSION_BUDGET) {
      const n = open.take();
      const p = nodePlayer[n]!;
      const bs = nodeBoxes[n]!;
      const g = nodeCost[n]!;
      // Stale entry: a cheaper route to this state was recorded.
      if ((best.get(stateKey(p, bs)) ?? Infinity) < g) continue;
      if (bs.every((b) => goalSet.has(b))) {
        let moves = '';
        for (let t = n; t > 0; t = nodeParent[t]!) moves = nodeStep[t]! + moves;
        return { moves, boxes: bs };
      }
      expanded++;
      const boxSet = new Set(bs);
      const reach = reachable(p, boxSet, inScope);
      for (let bi = 0; bi < bs.length; bi++) {
        const b = bs[bi]!;
        const [bx, by] = xy(b);
        for (const d of DIRS) {
          const tx = bx + d.dx;
          const ty = by + d.dy;
          const sx = bx - d.dx;
          const sy = by - d.dy;
          // The target square must be inside, free of walls and boxes.
          // (isWall is already true outside the level, so no separate
          // bounds check is needed here.)
          if (isWall(tx, ty) || boxSet.has(idx(tx, ty))) continue;
          if (!inside(sx, sy)) continue;
          const stand = idx(sx, sy);
          const walk = reach.get(stand);
          if (walk === undefined) continue;
          const nextBoxes = [...bs];
          nextBoxes[bi] = idx(tx, ty);
          nextBoxes.sort((a, b2) => a - b2);
          if (nextBoxes.some((x) => cornerDead(x))) continue;
          const g2 = g + 1;
          // After the push the player stands on the box's old square.
          const k = stateKey(b, nextBoxes);
          if ((best.get(k) ?? Infinity) <= g2) continue;
          const t = nodePlayer.length;
          nodePlayer.push(b);
          nodeBoxes.push(nextBoxes);
          nodeCost.push(g2);
          nodeParent.push(n);
          nodeStep.push(walk + d.ch);
          best.set(k, g2);
          open.add(g2 + estimate(nextBoxes), g2, t);
        }
      }
    }
    return null;
  }

  // ---- Stitch the rooms together in door-distance order. ----
  rooms.sort(
    (a, b) =>
      Math.abs(xy(a.door)[0] - xy(level.player)[0]) -
        Math.abs(xy(b.door)[0] - xy(level.player)[0]) || a.door - b.door,
  );
  let boxes = [...level.boxes];
  let player = level.player;
  let allMoves = '';
  for (const room of rooms) {
    const [doorX, doorY] = xy(room.door);
    let entry = -1;
    for (const d of DIRS) {
      const nx = doorX + d.dx;
      const ny = doorY + d.dy;
      if (ny === hallRow && inside(nx, ny) && wall[idx(nx, ny)] === 0) {
        entry = idx(nx, ny);
        break;
      }
    }
    if (entry < 0) return '';
    const travel = walkPath(player, entry, new Set(boxes), () => true);
    if (travel === null) return '';
    allMoves += travel;
    player = entry;
    const solved = solveRoom(room, entry, boxes);
    if (!solved) return '';
    allMoves += solved.moves;
    // Replay the room's moves to track the player's final square and the
    // boxes that stayed outside this room.
    const boxSet = new Set(boxes);
    let p = entry;
    for (const ch of solved.moves) {
      const [dx, dy] = DELTA[ch]!;
      const [px, py] = xy(p);
      const ni = idx(px + dx, py + dy);
      if (boxSet.has(ni)) {
        boxSet.delete(ni);
        boxSet.add(idx(px + 2 * dx, py + 2 * dy));
      }
      p = ni;
    }
    boxes = [...boxSet].sort((a, b) => a - b);
    player = p;
  }
  return allMoves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const moves = solveLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
