import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMoveOps, fullInsertIndex, isWithin, orderNumber, type ReorganizeOp, type ReorganizePage } from '../src/lib/utils/reorganize-ops.ts';

// getgrav/grav-admin-next#36:
//   /parent
//     01.chapter
//       01.child1
//       02.child2
//     02.chapter2
const parentKids = [
	{ route: '/parent/chapter', order: '01.' },
	{ route: '/parent/chapter2', order: '02.' },
];
const child1 = { route: '/parent/chapter/child1', order: '01.' };
const child2 = { route: '/parent/chapter/child2', order: '02.' };

/** No op may point into a folder another op in the same batch renames. */
function assertNoOpUnderARenamedFolder(ops: ReorganizeOp[]) {
	const renamed = ops.map((o) => o.route);
	for (const op of ops) {
		const where = op.parent ?? op.route.slice(0, op.route.lastIndexOf('/'));
		for (const r of renamed) {
			if (r !== op.route && (where === r || where.startsWith(r + '/'))) {
				assert.fail(`${op.route} points into ${r}, which the same batch renames`);
			}
		}
	}
}

/**
 * The folder as it ends up: each page with the number it has after the ops
 * (null when unnumbered), in Grav's default order (numbered ascending, then
 * unnumbered by name). Fails when two pages would share a number.
 */
function apply(siblings: ReorganizePage[], page: ReorganizePage, ops: ReorganizeOp[], crossParent: boolean): [string, number | null][] {
	const set = new Map(ops.map((o) => [o.route, o]));
	const pages = crossParent ? [...siblings, page] : siblings;
	const result = pages.map((p): [string, number | null] => {
		const op = set.get(p.route);
		if (op?.position !== undefined) return [p.route, op.position];
		if (crossParent && p.route === page.route) return [p.route, null];
		return [p.route, orderNumber(p.order)];
	});
	const numbers = result.map(([, n]) => n).filter((n) => n !== null);
	assert.equal(new Set(numbers).size, numbers.length, `two pages share a number: ${JSON.stringify(result)}`);
	const name = (r: string) => r.slice(r.lastIndexOf('/') + 1);
	return result.sort(([ra, a], [rb, b]) => {
		if (a !== null && b !== null) return a - b;
		if (a !== null) return -1;
		if (b !== null) return 1;
		return name(ra).localeCompare(name(rb));
	});
}

const routes = (r: [string, number | null][]) => r.map(([route]) => route.slice(route.lastIndexOf('/') + 1));

// ── The reporter's moves ───────────────────────────────────────────────────

test('tree: moving child1 up to the top of parent leaves the folder it left alone', () => {
	const ops = buildMoveOps({ page: child1, fromParent: '/parent/chapter', toParent: '/parent', siblings: parentKids, insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter/child1', parent: '/parent', position: 1 },
		{ route: '/parent/chapter', position: 2 },
		{ route: '/parent/chapter2', position: 3 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

test('tree: the second move (child2 up, after the first) points at the folder by its current name', () => {
	// After the first move: /parent = 01.child1, 02.chapter(02.child2), 03.chapter2.
	const siblings = [
		{ route: '/parent/child1', order: '01.' },
		{ route: '/parent/chapter', order: '02.' },
		{ route: '/parent/chapter2', order: '03.' },
	];
	const page = { route: '/parent/chapter/child2', order: '02.' };
	const ops = buildMoveOps({ page, fromParent: '/parent/chapter', toParent: '/parent', siblings, insertAt: 2 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter/child2', parent: '/parent', position: 3 },
		{ route: '/parent/chapter2', position: 4 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

test('columns: moving child2 up between the two folders sends no op for the folder that keeps its number', () => {
	const ops = buildMoveOps({ page: child2, fromParent: '/parent/chapter', toParent: '/parent', siblings: parentKids, insertAt: 1 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter/child2', parent: '/parent', position: 2 },
		{ route: '/parent/chapter2', position: 3 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

test('columns: moving a folder down a level into its sibling does not renumber the folder it lands in', () => {
	const ops = buildMoveOps({ page: parentKids[1], fromParent: '/parent', toParent: '/parent/chapter', siblings: [child1, child2], insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter2', parent: '/parent/chapter', position: 1 },
		{ route: '/parent/chapter/child1', position: 2 },
		{ route: '/parent/chapter/child2', position: 3 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

// ── Start, end and empty folders ───────────────────────────────────────────

test('dropping at the end of a folder is one op', () => {
	const ops = buildMoveOps({ page: parentKids[1], fromParent: '/parent', toParent: '/parent/chapter', siblings: [child1, child2], insertAt: 2 });
	assert.deepEqual(ops, [{ route: '/parent/chapter2', parent: '/parent/chapter', position: 3 }]);
});

test('dropping into a folder with no children sends parent and position 1', () => {
	const ops = buildMoveOps({ page: parentKids[1], fromParent: '/parent', toParent: '/empty', siblings: [], insertAt: 0 });
	assert.deepEqual(ops, [{ route: '/parent/chapter2', parent: '/empty', position: 1 }]);
});

test('an unnumbered page dropped into a folder with no children stays unnumbered', () => {
	const ops = buildMoveOps({ page: { route: '/loose', order: null }, fromParent: '/', toParent: '/empty', siblings: [], insertAt: 0 });
	assert.deepEqual(ops, [{ route: '/loose', parent: '/empty' }]);
});

test('dropping at the start of the root folder', () => {
	const root = [{ route: '/home', order: '01.' }, { route: '/parent', order: '02.' }];
	const ops = buildMoveOps({ page: child1, fromParent: '/parent/chapter', toParent: '/', siblings: root, insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter/child1', parent: '/', position: 1 },
		{ route: '/home', position: 2 },
		{ route: '/parent', position: 3 },
	]);
});

// ── Within one folder ──────────────────────────────────────────────────────

test('moving a page down inside its folder lands in front of the row it was dropped on', () => {
	const kids = ['a', 'b', 'c', 'd'].map((s, i) => ({ route: `/f/${s}`, order: `0${i + 1}.` }));
	// Dropped in front of d: a ends up between c and d.
	const ops = buildMoveOps({ page: kids[0], fromParent: '/f', toParent: '/f', siblings: kids, insertAt: 3 });
	assert.deepEqual(routes(apply(kids, kids[0], ops, false)), ['b', 'c', 'a', 'd']);
});

test('moving the first page to the end renames only that page', () => {
	const kids = ['a', 'b', 'c'].map((s, i) => ({ route: `/f/${s}`, order: `0${i + 1}.` }));
	const ops = buildMoveOps({ page: kids[0], fromParent: '/f', toParent: '/f', siblings: kids, insertAt: 3 });
	assert.deepEqual(ops, [{ route: '/f/a', position: 4 }]);
});

test('a reorder inside a big folder sends only the pages whose number changes', () => {
	const kids = Array.from({ length: 120 }, (_, i) => ({ route: `/blog/p${i + 1}`, order: String(i + 1).padStart(3, '0') + '.' }));
	// p3 dropped in front of p5.
	const ops = buildMoveOps({ page: kids[2], fromParent: '/blog', toParent: '/blog', siblings: kids, insertAt: 4 });
	assert.deepEqual(ops, [
		{ route: '/blog/p3', position: 4 },
		{ route: '/blog/p4', position: 3 },
	]);
});

test('dropping a page where it already is sends nothing', () => {
	for (const insertAt of [1, 2]) {
		const ops = buildMoveOps({ page: child2, fromParent: '/parent/chapter', toParent: '/parent/chapter', siblings: [child1, child2], insertAt });
		assert.deepEqual(ops, []);
	}
});

// ── The 50-op cap ──────────────────────────────────────────────────────────

test('moving a page with 60 children is one op: the children travel with the folder', () => {
	// The children are not in the request at all; only the destination's
	// siblings are, and dropping at the end renumbers none of them.
	const big = { route: '/sixty', order: '04.' };
	const ops = buildMoveOps({ page: big, fromParent: '/', toParent: '/parent', siblings: parentKids, insertAt: 2 });
	assert.deepEqual(ops, [{ route: '/sixty', parent: '/parent', position: 3 }]);
});

test('the op count is the moved page plus only the siblings that need a new number', () => {
	// A gap at 04 absorbs the shift: d and e keep 05 and 06.
	const kids = [['a', 1], ['b', 2], ['c', 3], ['d', 5], ['e', 6]].map(([s, n]) => ({ route: `/f/${s}`, order: `0${n}.` }));
	const page = { route: '/x', order: '07.' };
	const ops = buildMoveOps({ page, fromParent: '/', toParent: '/f', siblings: kids, insertAt: 1 });
	assert.deepEqual(ops, [
		{ route: '/x', parent: '/f', position: 2 },
		{ route: '/f/b', position: 3 },
		{ route: '/f/c', position: 4 },
	]);
	assert.deepEqual(routes(apply(kids, page, ops, true)), ['a', 'x', 'b', 'c', 'd', 'e']);
});

test('a drop in a folder of 60 numbered pages stays under the cap unless it shifts more than 49 of them', () => {
	const kids = Array.from({ length: 60 }, (_, i) => ({ route: `/sixty/c${i + 1}`, order: String(i + 1).padStart(2, '0') + '.' }));
	const page = { route: '/x', order: '01.' };
	// In front of c20: c20..c60 (41 pages) shift by one.
	const ops = buildMoveOps({ page, fromParent: '/', toParent: '/sixty', siblings: kids, insertAt: 19 });
	assert.equal(ops.length, 1 + 41);
	assert.deepEqual(ops[0], { route: '/x', parent: '/sixty', position: 20 });
	// At the very start every one of the 60 shifts, which the server refuses (cap 50).
	assert.equal(buildMoveOps({ page, fromParent: '/', toParent: '/sixty', siblings: kids, insertAt: 0 }).length, 61);
});

// ── Pages without a number ─────────────────────────────────────────────────

const mixed = [
	{ route: '/m/a', order: '01.' },
	{ route: '/m/b', order: '02.' },
	{ route: '/m/c', order: null },
	{ route: '/m/d', order: '' },
];

test('all-unnumbered folder: an unnumbered page just moves, nothing is numbered', () => {
	const kids = [{ route: '/docs/a', order: null }, { route: '/docs/b', order: '' }];
	const page = { route: '/x', order: null };
	for (const insertAt of [0, 1, 2]) {
		assert.deepEqual(buildMoveOps({ page, fromParent: '/', toParent: '/docs', siblings: kids, insertAt }), [{ route: '/x', parent: '/docs' }]);
	}
});

test('all-unnumbered folder: a numbered page keeps a number and no sibling gets one', () => {
	const kids = [{ route: '/docs/a', order: null }, { route: '/docs/b', order: null }];
	const page = { route: '/x', order: '03.' };
	assert.deepEqual(buildMoveOps({ page, fromParent: '/', toParent: '/docs', siblings: kids, insertAt: 2 }), [
		{ route: '/x', parent: '/docs', position: 1 },
	]);
});

test('all-unnumbered folder: reordering an unnumbered page changes nothing', () => {
	const kids = [{ route: '/docs/a', order: null }, { route: '/docs/b', order: null }];
	assert.deepEqual(buildMoveOps({ page: kids[1], fromParent: '/docs', toParent: '/docs', siblings: kids, insertAt: 0 }), []);
});

test('mixed folder: an unnumbered page dropped among the numbered ones gets a free number', () => {
	const page = { route: '/x', order: null };
	const ops = buildMoveOps({ page, fromParent: '/', toParent: '/m', siblings: mixed, insertAt: 1 });
	assert.deepEqual(ops, [
		{ route: '/x', parent: '/m', position: 2 },
		{ route: '/m/b', position: 3 },
	]);
	assert.deepEqual(routes(apply(mixed, page, ops, true)), ['a', 'x', 'b', 'c', 'd']);
});

test('mixed folder: an unnumbered page dropped at the start numbers only the numbered siblings', () => {
	const page = { route: '/x', order: null };
	const ops = buildMoveOps({ page, fromParent: '/', toParent: '/m', siblings: mixed, insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/x', parent: '/m', position: 1 },
		{ route: '/m/a', position: 2 },
		{ route: '/m/b', position: 3 },
	]);
	assert.deepEqual(routes(apply(mixed, page, ops, true)), ['x', 'a', 'b', 'c', 'd']);
});

test('mixed folder: an unnumbered page dropped after the numbered ones, or at the end, stays unnumbered', () => {
	const page = { route: '/x', order: null };
	for (const insertAt of [2, 3, 4]) {
		assert.deepEqual(buildMoveOps({ page, fromParent: '/', toParent: '/m', siblings: mixed, insertAt }), [{ route: '/x', parent: '/m' }]);
	}
});

test('mixed folder: a numbered page dropped at the end becomes the last numbered page', () => {
	const page = { route: '/x', order: '09.' };
	const ops = buildMoveOps({ page, fromParent: '/', toParent: '/m', siblings: mixed, insertAt: 4 });
	assert.deepEqual(ops, [{ route: '/x', parent: '/m', position: 3 }]);
	assert.deepEqual(routes(apply(mixed, page, ops, true)), ['a', 'b', 'x', 'c', 'd']);
});

test('mixed folder: an unnumbered sibling moved in front of the numbered ones gets a number, the rest stay unnumbered', () => {
	const ops = buildMoveOps({ page: mixed[3], fromParent: '/m', toParent: '/m', siblings: mixed, insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/m/d', position: 1 },
		{ route: '/m/a', position: 2 },
		{ route: '/m/b', position: 3 },
	]);
	assert.deepEqual(routes(apply(mixed, mixed[3], ops, false)), ['d', 'a', 'b', 'c']);
});

test('mixed folder: moving an unnumbered page within the unnumbered ones changes nothing', () => {
	assert.deepEqual(buildMoveOps({ page: mixed[3], fromParent: '/m', toParent: '/m', siblings: mixed, insertAt: 2 }), []);
});

// ── Helpers ────────────────────────────────────────────────────────────────

test('a drop in a filtered or searched view lands next to the same row in the full folder', () => {
	const all = ['/f/a', '/f/b', '/f/c', '/f/d'];
	const visible = ['/f/b', '/f/d'];
	assert.equal(fullInsertIndex(visible, all, 0), 1);
	assert.equal(fullInsertIndex(visible, all, 1), 3);
	assert.equal(fullInsertIndex(visible, all, 2), 4);
	assert.equal(fullInsertIndex(['/f/b'], all, 1), 2);
	assert.equal(fullInsertIndex([], all, 0), 4);
	assert.equal(fullInsertIndex(all, all, 2), 2);
});

test('a page cannot be dropped into itself or below itself', () => {
	assert.equal(isWithin('/parent/chapter', '/parent/chapter'), true);
	assert.equal(isWithin('/parent/chapter/child1', '/parent/chapter'), true);
	assert.equal(isWithin('/parent/chapter2', '/parent/chapter'), false);
	assert.equal(isWithin('/', '/parent'), false);
});

test('random folders: the result is the dropped order, no number repeats, unnumbered siblings are never touched', () => {
	let seed = 36;
	const rand = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	for (let run = 0; run < 2000; run++) {
		// Numbered pages (with random gaps) first, then unnumbered ones by name.
		const numberedCount = rand(8);
		const plainCount = rand(4);
		const kids: ReorganizePage[] = [];
		let n = 0;
		for (let i = 0; i < numberedCount; i++) {
			n += 1 + rand(3);
			kids.push({ route: `/f/n${i}`, order: String(n).padStart(2, '0') + '.' });
		}
		for (let i = 0; i < plainCount; i++) kids.push({ route: `/f/u${i}`, order: null });

		const cross = kids.length === 0 || rand(2) === 0;
		const page: ReorganizePage = cross
			? { route: '/x', order: rand(2) ? String(1 + rand(9)).padStart(2, '0') + '.' : null }
			: kids[rand(kids.length)];
		const insertAt = rand(kids.length + 1);
		const ops = buildMoveOps({ page, fromParent: cross ? '/' : '/f', toParent: '/f', siblings: kids, insertAt });

		for (const op of ops) {
			if (op.route !== page.route) {
				assert.notEqual(orderNumber(kids.find((k) => k.route === op.route)?.order), null, `unnumbered sibling ${op.route} got an op`);
			}
		}
		const result = apply(kids, page, ops, cross);

		// The intended order, restricted to what Grav can show: numbered pages in
		// drop order must come out in that order.
		const list = kids.filter((k) => k.route !== page.route);
		const from = kids.findIndex((k) => k.route === page.route);
		list.splice(from !== -1 && from < insertAt ? insertAt - 1 : insertAt, 0, page);
		const numberedNow = new Set(result.filter(([, num]) => num !== null).map(([r]) => r));
		assert.deepEqual(
			result.filter(([r]) => numberedNow.has(r)).map(([r]) => r),
			list.filter((k) => numberedNow.has(k.route)).map((k) => k.route),
		);
	}
});
