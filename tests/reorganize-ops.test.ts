import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMoveOps, type ReorganizeOp } from '../src/lib/utils/reorganize-ops.ts';

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

test('moving a child up above its own folder leaves the folder it left alone (tree view)', () => {
	const ops = buildMoveOps({ page: child1, fromParent: '/parent/chapter', toParent: '/parent', siblings: parentKids, insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter/child1', parent: '/parent', position: 1 },
		{ route: '/parent/chapter', position: 2 },
		{ route: '/parent/chapter2', position: 3 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

test('moving a child up between two folders sends no op for the folder that keeps its number (columns view)', () => {
	const ops = buildMoveOps({ page: child2, fromParent: '/parent/chapter', toParent: '/parent', siblings: parentKids, insertAt: 1 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter/child2', parent: '/parent', position: 2 },
		{ route: '/parent/chapter2', position: 3 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

test('moving a folder down into its sibling does not renumber the folder it lands in', () => {
	const ops = buildMoveOps({ page: parentKids[1], fromParent: '/parent', toParent: '/parent/chapter', siblings: [child1, child2], insertAt: 0 });
	assert.deepEqual(ops, [
		{ route: '/parent/chapter2', parent: '/parent/chapter', position: 1 },
		{ route: '/parent/chapter/child1', position: 2 },
		{ route: '/parent/chapter/child2', position: 3 },
	]);
	assertNoOpUnderARenamedFolder(ops);
});

test('a reorder inside a big folder sends only the pages whose number changes', () => {
	const kids = Array.from({ length: 120 }, (_, i) => ({ route: `/blog/p${i + 1}`, order: String(i + 1).padStart(3, '0') + '.' }));
	const ops = buildMoveOps({ page: kids[2], fromParent: '/blog', toParent: '/blog', siblings: kids, insertAt: 3 });
	assert.deepEqual(ops, [
		{ route: '/blog/p3', position: 4 },
		{ route: '/blog/p4', position: 3 },
	]);
});

test('dropping a page where it already is sends nothing', () => {
	const ops = buildMoveOps({ page: child2, fromParent: '/parent/chapter', toParent: '/parent/chapter', siblings: [child1, child2], insertAt: 1 });
	assert.deepEqual(ops, []);
});

test('unnumbered pages keep their names unless every page is to be numbered', () => {
	const kids = [{ route: '/docs/a', order: null }, { route: '/docs/b', order: '' }];
	const page = { route: '/x', order: null };
	assert.deepEqual(buildMoveOps({ page, fromParent: '/', toParent: '/docs', siblings: kids, insertAt: 1 }), [
		{ route: '/x', parent: '/docs' },
	]);
	assert.deepEqual(buildMoveOps({ page, fromParent: '/', toParent: '/docs', siblings: kids, insertAt: 1, numberAll: true }), [
		{ route: '/x', parent: '/docs', position: 2 },
		{ route: '/docs/a', position: 1 },
		{ route: '/docs/b', position: 3 },
	]);
});
