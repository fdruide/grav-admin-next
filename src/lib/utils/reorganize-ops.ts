/**
 * The one place the Tree, List and Columns views turn a drag into
 * `POST /pages/reorganize` operations, so the same move sends the same
 * request from every view (getgrav/grav-admin-next#36).
 *
 * - Only pages whose number actually changes get an op, so a move sends a
 *   handful of ops instead of one per sibling (the server caps a batch at
 *   `plugins.api.batch.max_items`, 50 by default).
 * - The moved page's op comes first, so it leaves its old folder before any
 *   folder above it is renumbered.
 * - The folder the page left is not renumbered. The gap it leaves changes
 *   nothing (Grav sorts by the number), and renumbering it renamed folders
 *   that other ops in the same batch pointed into, which the server rejects
 *   or, before api 1.0.47, silently skipped.
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
	/** Every child of `toParent`, in display order. May include `page`. */
	siblings: ReorganizePage[];
	/** Index the page ends up at in `toParent` once it has been taken out of `siblings`. */
	insertAt: number;
	/** Number the unnumbered siblings too, so the result matches the drop exactly. */
	numberAll?: boolean;
}

export function orderNumber(order: string | null | undefined): number | null {
	if (!order) return null;
	const n = parseInt(order, 10);
	return Number.isFinite(n) ? n : null;
}

export function buildMoveOps({ page, fromParent, toParent, siblings, insertAt, numberAll = false }: MoveRequest): ReorganizeOp[] {
	const crossParent = fromParent !== toParent;
	const list = siblings.filter((p) => p.route !== page.route);
	list.splice(Math.max(0, Math.min(insertAt, list.length)), 0, page);

	// A folder "uses ordering" when any page in it, the moved one included,
	// carries a number. Only numbered pages are renumbered (numbering the rest
	// would rename them), unless the caller asks for every page.
	const ordered = numberAll || list.some((p) => orderNumber(p.order) !== null);

	let movedOp: ReorganizeOp | null = null;
	const ops: ReorganizeOp[] = [];
	list.forEach((p, i) => {
		const current = orderNumber(p.order);
		if (p.route === page.route) {
			const position = ordered || !crossParent ? i + 1 : undefined;
			if (!crossParent && position === current) return;
			movedOp = { route: p.route, ...(crossParent ? { parent: toParent } : {}), ...(position !== undefined ? { position } : {}) };
			return;
		}
		if (!numberAll && current === null) return;
		if (current !== i + 1) ops.push({ route: p.route, position: i + 1 });
	});

	return movedOp ? [movedOp, ...ops] : ops;
}
