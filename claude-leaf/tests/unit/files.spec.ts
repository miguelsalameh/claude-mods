import { describe, expect, test } from 'bun:test'
import { type Entry, rank, walk } from '../../hooks/files.ts'

type Tree = { [name: string]: Tree | string }

const lister = (root: string, tree: Tree, calls: string[] = [], failing: string[] = []) =>
  async (dir: string): Promise<Entry[]> => {
    calls.push(dir)
    if (failing.includes(dir)) throw new Error('EACCES')
    const rel = dir === root ? '' : dir.slice(root.length + 1)
    let node: Tree | string | undefined = tree
    for (const part of rel === '' ? [] : rel.split('/')) node = typeof node === 'object' ? node[part] : undefined
    if (typeof node !== 'object') throw new Error(`ENOENT ${dir}`)
    return Object.entries(node).map(([name, v]) => ({ name, kind: typeof v === 'object' ? 'dir' : name === 'link' ? 'other' : 'file' }))
  }

const tree: Tree = {
  'README.md': '',
  'notes.txt': '',
  'z.mdx': '',
  'A.MARKDOWN': '',
  link: '',
  docs: { 'design.md': '', sub: { 'deep.md': '' }, 'image.png': '' },
  node_modules: { 'pkg.md': '' },
  '.git': { 'x.md': '' },
  '.hidden': { 'h.md': '' },
  dist: { 'd.md': '' },
  build: { 'b.md': '' },
  '.next': { 'n.md': '' },
  target: { 't.md': '' },
  vendor: { 'v.md': '' },
  '.venv': { 'e.md': '' },
}

describe('walk', () => {
  test('collects markdown files, skips the listed and dot directories, sorted', async () => {
    const calls: string[] = []
    const out = await walk(lister('/r', tree, calls), '/r')
    expect(out).toEqual(['A.MARKDOWN', 'README.md', 'docs/design.md', 'docs/sub/deep.md', 'z.mdx'])
    expect(calls.sort()).toEqual(['/r', '/r/docs', '/r/docs/sub'])
  })
  test('maxDepth limits descent', async () => {
    expect(await walk(lister('/r', tree), '/r', { maxDepth: 1 })).toEqual(['A.MARKDOWN', 'README.md', 'docs/design.md', 'z.mdx'])
    expect(await walk(lister('/r', tree), '/r', { maxDepth: 0 })).toEqual(['A.MARKDOWN', 'README.md', 'z.mdx'])
  })
  test('maxFiles caps the result', async () => {
    const out = await walk(lister('/r', tree), '/r', { maxFiles: 2 })
    expect(out.length).toBe(2)
  })
  test('a failing subdirectory is skipped', async () => {
    const out = await walk(lister('/r', tree, [], ['/r/docs']), '/r')
    expect(out).toEqual(['A.MARKDOWN', 'README.md', 'z.mdx'])
  })
  test('a failing root rejects', async () => {
    await expect(walk(lister('/r', tree, [], ['/r']), '/r')).rejects.toThrow()
  })
})

describe('rank', () => {
  const paths = ['docs/design.md', 'README.md', 'src/deep/esign.md', 'notes/todo.md', 'design.md']
  test('empty query keeps order, sliced to limit', () => {
    expect(rank(paths, '')).toEqual(paths)
    expect(rank(paths, '', 2)).toEqual(paths.slice(0, 2))
  })
  test('non-matches excluded, case-insensitive', () => {
    expect(rank(paths, 'TODO')).toEqual(['notes/todo.md'])
    expect(rank(paths, 'xyz')).toEqual([])
  })
  test('shorter path wins a tie', () => {
    expect(rank(paths, 'design').slice(0, 2)).toEqual(['design.md', 'docs/design.md'])
  })
  test('consecutive and word-start matches beat scattered ones', () => {
    expect(rank(['d/e/s/i/g/n.md', 'design.md'], 'design')[0]).toBe('design.md')
    expect(rank(['abcread.md', 'abc/read.md'], 'read')[0]).toBe('abc/read.md')
  })
  test('basename matches beat directory matches', () => {
    expect(rank(['plan/x.md', 'x/plan.md'], 'plan')[0]).toBe('x/plan.md')
  })
  test('limit applies', () => {
    expect(rank(paths, 'md', 2).length).toBe(2)
  })
  test('alphabetical on equal score and length', () => {
    expect(rank(['b.md', 'a.md'], 'md')).toEqual(['a.md', 'b.md'])
  })
})
