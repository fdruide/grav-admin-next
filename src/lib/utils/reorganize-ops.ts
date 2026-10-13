/**
 * The one place the Tree and Columns views turn a drag into
 * `POST /pages/reorganize` operations, so the same move sends the same
 * request from either view (getgrav/grav-admin-next#36).
 *
 * - A page without a number prefix never gets one just because a sibling
 *   moved: the prefix is what makes a page show up in the menu.
 * - The moved page keeps its number if it has one. An unnumbered page only
 *   gets a number when it is dropped in front of a numbered sibling, since
 *   without one it would sort after them by name.
 * - Only pages whose number has to change get an op, so a move sends a
 *   handful of ops instead of one per sibling (the server caps a batch at
 *   `plugins.api.batch.max_items`, 50 by default). Pages whose number still
 *   fits after the drop keep it, gaps included.
 * - The moved page's op comes first. The folder it left is not renumbered:
 *   the gap changes nothing (Grav sorts by the number), and renumbering it
 *   renamed folders other ops in the same batch pointed into.
 */

export interface ReorganizePage {
	/** Api route (`pageApiRoute()`), not the public route. */
	route: string;
	/** Folder prefix as the listing returns it (`"02."`), or null/'' when unnumbered. */
	order?: string | null;
}

export interface ReorganizeOp {
	route: string;
	parent?: string;
	position?: number;
}

export interface MoveRequest {
	page: ReorganizePage;
	/** Api route of the folder the page is in now. */
	fromParent: string;
	/** Api route of the folder it is dropped into (may equal fromParent). */
	toParent: string;
	/**
	 * Every child of `toParent` in display order (numbered pages first, then
	 * unnumbered ones by name), including `page` when it stays in its folder.
	 */
	siblings: ReorganizePage[];
	/**
	 * Index in `siblings` the page is dropped in front of, counted with the
	 * page still in its old place; `siblings.length` drops it at the end.
	 */
	insertAt: number;
}

export function orderNumber(order: string | null | undefined): number | null {
	if (!order) return null;
	const n = parseInt(order, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Where a page dropped at `insertAt` ends up once it has left its old place. */
export function landingIndex(siblings: ReorganizePage[], route: string, insertAt: number): number {
	let at = Math.max(0, Math.min(insertAt, siblings.length));
	const from = siblings.findIndex((p) => p.route === route);
	if (from !== -1 && from < at) at -= 1;
	return at;
}

/**
 * Positions in `numbers` whose value can stay: the longest run where
 * `number - position` never decreases and every number leaves room for the
 * pages in front of it. Every other page then fits between its neighbours.
 */
function keepable(numbers: (number | null)[]): Set<number> {
	const tailKey: number[] = [];
	const tailAt: number[] = [];
	const prev = new Array<number>(numbers.length).fill(-1);
	numbers.forEach((n, i) => {
		if (n === null) return;
		const key = n - i;
		if (key < 1) return;
		let lo = 0;
		let hi = tailKey.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (tailKey[mid] <= key) lo = mid + 1;
			else hi = mid;
		}
		prev[i] = lo > 0 ? tailAt[lo - 1] : -1;
		tailKey[lo] = key;
		tailAt[lo] = i;
	});
	const keep = new Set<number>();
	for (let i = tailAt.length ? tailAt[tailAt.length - 1] : -1; i !== -1; i = prev[i]) keep.add(i);
	return keep;
}

export function buildMoveOps({ page, fromParent, toParent, siblings, insertAt }: MoveRequest): ReorganizeOp[] {
	const crossParent = fromParent !== toParent;
	const at = landingIndex(siblings, page.route, insertAt);
	const list = siblings.filter((p) => p.route !== page.route);
	list.splice(at, 0, page);

	const own = orderNumber(page.order);
	const numbered = own !== null || list.slice(at + 1).some((p) => orderNumber(p.order) !== null);

	if (!numbered) {
		// Stays unnumbered and lands among the unnumbered pages by name.
		return crossParent ? [{ route: page.route, parent: toParent }] : [];
	}

	// The numbered pages in their new order, with the number each has now in
	// this folder (the moved page has none here when it changes folder).
	const seq = list.filter((p) => p.route === page.route || orderNumber(p.order) !== null);
	const current = seq.map((p) => (p.route === page.route ? (crossParent ? null : own) : orderNumber(p.order)));
	const keep = keepable(current);

	let movedOp: ReorganizeOp | null = null;
	const ops: ReorganizeOp[] = [];
	let last = 0;
	seq.forEach((p, i) => {
		const position = keep.has(i) ? (current[i] as number) : last + 1;
		last = position;
		if (p.route === page.route) {
			if (crossParent) movedOp = { route: p.route, parent: toParent, position };
			else if (position !== current[i]) movedOp = { route: p.route, position };
		} else if (position !== current[i]) {
			ops.push({ route: p.route, position });
		}
	});

	return movedOp ? [movedOp, ...ops] : ops;
}

/**
 * Turn a drop position in the rows a view shows (`visible`, which a filter or
 * search may have narrowed) into one in the folder's full child list.
 * Dropping in front of a row lands in front of that row; dropping after the
 * last shown row lands right after it.
 */
export function fullInsertIndex(visible: string[], all: string[], visibleIndex: number): number {
	if (visibleIndex < visible.length) {
		const i = all.indexOf(visible[Math.max(0, visibleIndex)]);
		if (i !== -1) return i;
	}
	if (visible.length > 0) {
		const i = all.indexOf(visible[visible.length - 1]);
		if (i !== -1) return i + 1;
	}
	return all.length;
}

/** True when `parent` is `route` itself or lies inside it. */
export function isWithin(parent: string, route: string): boolean {
	return parent === route || parent.startsWith(route.replace(/\/$/, '') + '/');
}
