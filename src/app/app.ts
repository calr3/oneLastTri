import { Component, HostListener, computed, signal } from '@angular/core';

export type Player = 'black' | 'white';

export interface Move {
  player: Player;
  cellId: number;
  tile: number;
}

export interface Cell {
  id: number;
  points: string;
  cx: number;
  cy: number;
  adjacentIds: number[];
  owner: Player | null;
  value: number | null;
}

// ─── Board geometry ───────────────────────────────────────────────────────────
// 21 triangles in 4 rows.  Row 0–1 start with ▲ (upward); rows 2–3 start with ▽.
// Row offsets shift so the shape is a hexagon with its upper-right corner removed.
//
//   row 0 (5):  ▲▽▲▽▲           ids  0– 4
//   row 1 (7):  ▲▽▲▽▲▽▲         ids  5–11
//   row 2 (4):  ▽▲▽▲             ids 12–15
//   row 3 (5):  ▽▲▽▲▽            ids 16–20

const S = 70;                             // side length px
const H = S * Math.sqrt(3) / 2;          // height px ≈ 60.62
const PAD = 25;                           // horizontal padding
const YPAD = 14;                          // vertical padding
const OFFSETS = [PAD + S / 2, PAD, PAD, PAD + S / 2]; // x start per row

const COORDS: [number, number][] = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
  [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
  [2, 0], [2, 1], [2, 2], [2, 3],
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4],
];

// 24 edge-sharing pairs (verified by geometry)
const ADJ_PAIRS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],                   // row 0
  [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], // row 1
  [12, 13], [13, 14], [14, 15],                      // row 2
  [16, 17], [17, 18], [18, 19], [19, 20],            // row 3
  [0, 6], [2, 8], [4, 10],                           // row 0 → row 1
  [5, 12], [7, 14],                                  // row 1 → row 2
  [13, 16], [15, 18],                                // row 2 → row 3
];

function isUp(row: number, col: number): boolean {
  return (row <= 1 && col % 2 === 0) || (row >= 2 && col % 2 === 1);
}

function polyPoints(row: number, col: number): string {
  const xL = OFFSETS[row] + col * (S / 2);
  const yT = row * H + YPAD;
  const r = (n: number) => +n.toFixed(1);
  return isUp(row, col)
    ? `${r(xL + S / 2)},${r(yT)} ${r(xL)},${r(yT + H)} ${r(xL + S)},${r(yT + H)}`
    : `${r(xL)},${r(yT)} ${r(xL + S)},${r(yT)} ${r(xL + S / 2)},${r(yT + H)}`;
}

function centroid(row: number, col: number): [number, number] {
  const xL = OFFSETS[row] + col * (S / 2);
  const yT = row * H + YPAD;
  return [
    +(xL + S / 2).toFixed(1),
    +(isUp(row, col) ? yT + H * 2 / 3 : yT + H / 3).toFixed(1),
  ];
}

function buildAdj(): number[][] {
  const a: number[][] = Array.from({ length: 21 }, () => []);
  for (const [x, y] of ADJ_PAIRS) { a[x].push(y); a[y].push(x); }
  return a;
}

const ADJ = buildAdj();

const CELL_LETTERS = 'abcdefghijklmnopqrstu';

function initCells(): Cell[] {
  return COORDS.map(([r, c], id) => {
    const [cx, cy] = centroid(r, c);
    return { id, points: polyPoints(r, c), cx, cy, adjacentIds: ADJ[id], owner: null, value: null };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly viewBox = `0 0 ${PAD * 2 + S * 4} ${+(YPAD * 2 + H * 4).toFixed(1)}`;
  readonly allTiles = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  cells          = signal(initCells());
  blackHand      = signal([...this.allTiles]);
  whiteHand      = signal([...this.allTiles]);
  currentPlayer  = signal<Player>('black');
  selectedTile   = signal<number | null>(null);
  phase          = signal<'playing' | 'finished'>('playing');
  blackScore     = signal(0);
  whiteScore     = signal(0);
  winner         = signal<Player | 'tie' | null>(null);
  emptyCellId    = signal<number | null>(null);
  moveHistory    = signal<Move[]>([]);
  showNotation   = signal(false);
  showRules        = signal(false);
  showAnnotations  = signal(false);
  readonly cellLetters = CELL_LETTERS;
  copyOk         = signal<boolean | null>(null);

  gameNotation = computed(() => {
    const moves = this.moveHistory().map(m =>
      (m.player === 'black' ? 'B' : 'W') + m.tile + CELL_LETTERS[m.cellId]
    );
    const lines: string[] = [];
    for (let i = 0; i < moves.length; i += 10) lines.push(moves.slice(i, i + 10).join(' '));
    return lines.join('\n');
  });

  adjToEmpty = computed<Set<number>>(() => {
    const eid = this.emptyCellId();
    if (eid === null) return new Set();
    return new Set(this.cells()[eid].adjacentIds);
  });

  status = computed(() => {
    if (this.phase() === 'finished') return '';
    const name = this.currentPlayer() === 'black' ? 'Black' : 'White';
    const sel  = this.selectedTile();
    return sel !== null
      ? `${name}: click an empty triangle to place tile ${sel}`
      : `${name}'s turn — select a tile`;
  });

  // ─── Actions ──────────────────────────────────────────────────────────────

  clickTile(tile: number, player: Player): void {
    if (this.phase() !== 'playing' || this.currentPlayer() !== player) return;
    this.selectedTile.update(s => s === tile ? null : tile);
    navigator.vibrate?.(10);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key !== '`') return;
    if (this.phase() !== 'playing') return;
    this.aiMove();
  }

  @HostListener('document:keydown.space', ['$event'])
  onSpace(e: Event): void {
    e.preventDefault();
    if (this.phase() !== 'playing') return;
    const hand  = this.currentPlayer() === 'black' ? this.blackHand() : this.whiteHand();
    const empty = this.cells().filter(c => c.owner === null);
    if (!hand.length || !empty.length) return;
    const tile = hand[Math.floor(Math.random() * hand.length)];
    const cell = empty[Math.floor(Math.random() * empty.length)];
    this.selectedTile.set(null);
    this.place(cell, tile);
  }

  clickCell(cell: Cell): void {
    if (this.phase() !== 'playing' || cell.owner !== null) return;
    const tile = this.selectedTile();
    if (tile === null) return;
    this.selectedTile.set(null);
    navigator.vibrate?.(50);
    this.place(cell, tile);
  }

  saveGame(): void {
    this.copyOk.set(null);
    this.showNotation.set(true);
  }

  async copyNotation(): Promise<void> {
    let ok = false;
    try { await navigator.clipboard.writeText(this.gameNotation()); ok = true; } catch {}
    this.copyOk.set(ok);
  }

  closeNotation(): void { this.showNotation.set(false); this.copyOk.set(null); }

  openRules(): void        { this.showRules.set(true); }
  closeRules(): void       { this.showRules.set(false); }
  toggleAnnotations(): void { this.showAnnotations.update(v => !v); }

  private evalPosition(cells: Cell[], player: Player, hand: number[], oppHand: number[]): number {
    const opponent: Player = player === 'black' ? 'white' : 'black';
    const empty   = cells.filter(c => c.owner === null);
    const oppDesc = [...oppHand].sort((a, b) => b - a);
    const myDesc  = [...hand].sort((a, b) => b - a);

    let myDom = 0, oppDom = 0;
    for (const e of empty) {
      let myScore = 0, oppScore = 0, emptyCount = 0;
      for (const adjId of e.adjacentIds) {
        const adj = cells[adjId];
        if (adj.owner === player)        myScore  += adj.value!;
        else if (adj.owner === opponent) oppScore += adj.value!;
        else                             emptyCount++;
      }
      const oppFill = oppDesc.slice(0, emptyCount).reduce((s, t) => s + t, 0);
      const myFill  = myDesc.slice(0, emptyCount).reduce((s, t) => s + t, 0);
      if (myScore  > oppScore + oppFill) myDom++;
      if (oppScore > myScore  + myFill)  oppDom++;
    }

    const handSum = hand.reduce((s, t) => s + t, 0);
    const oppSum  = oppHand.reduce((s, t) => s + t, 0);
    return 55 * (myDom - oppDom) + (handSum - oppSum);
  }

  private negamax(
    cells: Cell[], blackHand: number[], whiteHand: number[],
    player: Player, depth: number
  ): number {
    const opponent: Player = player === 'black' ? 'white' : 'black';
    const hand    = player === 'black' ? blackHand : whiteHand;
    const oppHand = player === 'black' ? whiteHand : blackHand;

    if (depth === 0 || hand.length === 0) {
      return this.evalPosition(cells, player, hand, oppHand);
    }

    const empty = cells.filter(c => c.owner === null);
    let best = -Infinity;

    for (const tile of hand) {
      const newHand = [...hand];
      newHand.splice(newHand.indexOf(tile), 1);
      const [newBlack, newWhite] = player === 'black'
        ? [newHand, whiteHand] : [blackHand, newHand];

      for (const cell of empty) {
        const newCells = cells.map(c =>
          c.id === cell.id ? { ...c, owner: player, value: tile } : c
        );
        const score = -this.negamax(newCells, newBlack, newWhite, opponent, depth - 1);
        if (score > best) best = score;
      }
    }

    return best;
  }

  private aiMove(): void {
    const player: Player   = this.currentPlayer();
    const opponent: Player = player === 'black' ? 'white' : 'black';
    const cells     = this.cells();
    const blackHand = this.blackHand();
    const whiteHand = this.whiteHand();
    const hand      = player === 'black' ? blackHand : whiteHand;
    const empty     = cells.filter(c => c.owner === null);
    if (!hand.length || !empty.length) return;

    const depth = this.moveHistory().length < 10 ? 2 : 3;
    let bestScore = -Infinity;
    const bestMoves: { tile: number; cell: Cell }[] = [];

    for (const tile of hand) {
      const newHand = [...hand];
      newHand.splice(newHand.indexOf(tile), 1);
      const [newBlack, newWhite] = player === 'black'
        ? [newHand, whiteHand] : [blackHand, newHand];

      for (const cell of empty) {
        const newCells = cells.map(c =>
          c.id === cell.id ? { ...c, owner: player, value: tile } : c
        );
        const score = -this.negamax(newCells, newBlack, newWhite, opponent, depth - 1);

        if (score > bestScore) {
          bestScore = score;
          bestMoves.length = 0;
          bestMoves.push({ tile, cell });
        } else if (score === bestScore) {
          bestMoves.push({ tile, cell });
        }
      }
    }

    const chosen = bestMoves[Math.floor(Math.random() * bestMoves.length)];
    this.selectedTile.set(null);
    this.place(chosen.cell, chosen.tile);
  }

  private place(cell: Cell, tile: number): void {
    const player = this.currentPlayer();
    this.moveHistory.update(h => [...h, { player, cellId: cell.id, tile }]);
    this.cells.update(cs =>
      cs.map(c => c.id === cell.id ? { ...c, owner: player, value: tile } : c)
    );
    (player === 'black' ? this.blackHand : this.whiteHand)
      .update(h => h.filter(t => t !== tile));
    if (this.cells().filter(c => c.owner !== null).length === 20) {
      this.finishGame();
    } else {
      this.currentPlayer.update(p => p === 'black' ? 'white' : 'black');
    }
  }

  private finishGame(): void {
    const cells = this.cells();
    const empty = cells.find(c => c.owner === null)!;
    this.emptyCellId.set(empty.id);
    let b = 0, w = 0;
    for (const aid of empty.adjacentIds) {
      const c = cells[aid];
      if (c.owner === 'black') b += c.value!;
      else if (c.owner === 'white') w += c.value!;
    }
    this.blackScore.set(b);
    this.whiteScore.set(w);
    this.winner.set(b > w ? 'black' : w > b ? 'white' : 'tie');
    this.phase.set('finished');
  }

  newGame(): void {
    this.cells.set(initCells());
    this.blackHand.set([...this.allTiles]);
    this.whiteHand.set([...this.allTiles]);
    this.currentPlayer.set('black');
    this.selectedTile.set(null);
    this.phase.set('playing');
    this.blackScore.set(0);
    this.whiteScore.set(0);
    this.winner.set(null);
    this.emptyCellId.set(null);
    this.moveHistory.set([]);
    this.showNotation.set(false);
  }
}
