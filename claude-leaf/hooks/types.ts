// The shapes every unit shares: the rows the layout draws, the notes, the
// theme, and the props and messages between the hooks module and the pane.
// See docs/design.md for what each field means.

export type Style =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'rule1' | 'rule2'
  | 'b' | 'i' | 'bi' | 's' | 'code' | 'link' | 'url' | 'dim'
  | 'bullet' | 'number' | 'check' | 'quote' | 'html' | 'hr'
  | 'frame' | 'lang' | 'gutter' | 'kw' | 'str' | 'comment'
  | 'tableBorder' | 'tableHead'
  // claude-mermaid's roles, so a diagram's segments map straight onto spans
  | 'border' | 'line' | 'arrow' | 'corner' | 'junction' | 'accent'
  | 'match' | 'matchCurrent' | 'selection' | 'note' | 'text'

export type Span = { t: string; s?: Style }

export type Row = {
  /** 0-based line of the source the row draws (a wrapped row keeps its first line's) */
  src: number
  spans: Span[]
}

export type TocEntry = {
  /** 1..6 */
  level: number
  text: string
  /** the heading's source line */
  src: number
  /** the heading's first row in the layout */
  row: number
}

export type Layout = { rows: Row[]; toc: TocEntry[] }

/** draws a mermaid source at most `width` cells wide; `{ error }` with the reason when it cannot */
export type Diagram = (source: string, width: number) => Span[][] | { error: string }

export type LayoutOptions = {
  width: number
  /** absent: mermaid fences are drawn as code */
  diagram?: Diagram
  /** line numbers in code frames; default true */
  codeLineNumbers?: boolean
}

export type Note = {
  /** 0-based source lines, a <= b */
  a: number
  b: number
  text: string
  /** the source lines a..b when the note was made: what re-anchoring looks for.
   *  The pane has no source text and posts `[]`; the hooks module fills it in on `notes`. */
  quote: string[]
  /** the quote was not found after a change: the note kept its lines */
  moved?: true
}

export type ThemeName =
  | 'ocean' | 'arctic' | 'forest' | 'solarized-dark'
  | 'catppuccin-mocha' | 'catppuccin-macchiato' | 'catppuccin-frappe' | 'catppuccin-latte'

export type Look = {
  color?: string
  backgroundColor?: string
  bold?: true
  italic?: true
  underline?: true
  dimColor?: true
  strikethrough?: true
  inverse?: true
}

export type Palette = Record<Style, Look>

export type SearchHit = {
  row: number
  /** cell columns in the row's plain text, `to` exclusive */
  from: number
  to: number
}

export type Mode = 'view' | 'edit' | 'toc' | 'search' | 'picker'

export type ViewerProps = {
  /** absolute path of the open file ('' while only the picker is up) */
  path: string
  name: string
  theme: ThemeName
  /** rows the whole document lays out to */
  total: number
  /** lines in the source */
  srcTotal: number
  /** the rows held: `rows[0]` is document row `start` */
  start: number
  rows: Row[]
  toc: TocEntry[]
  /** rows to draw, title and footer included */
  height: number
  /** the hooks module's notes: adopted when the instance is new or `notesVersion` moved */
  notes: Note[]
  notesVersion: number
  /** bumps on every reload of the file */
  version: number
  /** edit mode's view of the buffer (the buffer itself lives in the hooks module); null outside edit mode */
  edit: EditView | null
  /** the source line the cursor was on when edit mode last ended: view mode scrolls there */
  lastEditLine: number
  readOnly: boolean
  /** a one-line message from the hooks module (saved, conflict, error) */
  status: string | null
  statusVersion: number
  /** the last save found the file changed on disk */
  conflict: boolean
  /** an edit buffer with unsaved changes exists (shown as `● modified` in view mode too) */
  dirty: boolean
  /** the file changed on disk while the buffer had unsaved changes */
  changedOnDisk: boolean
  search: { query: string; hits: SearchHit[] } | null
  picker: { query: string; items: string[] } | null
  /** bumped each time the hooks module opens the picker: the pane shows it even over an open file */
  pickerVersion: number
  /**
   * mouse-wheel ticks over the pane since it opened, summed (negative toward
   * the top). The pane applies the difference from the total it last saw, so
   * ticks that land between two draws are never lost.
   */
  wheel: number
  /** the file could not be read: drawn instead of rows */
  error: string | null
}

export type EditView = {
  /** source line of `lines[0]` */
  first: number
  /** buffer lines from `first`, enough to fill the body (long lines wrap in the pane) */
  lines: string[]
  /** total lines in the buffer */
  total: number
  /** the first buffer line the body shows */
  top: number
  cursor: { line: number; col: number }
  dirty: boolean
  /** ctrl+e on a dirty buffer: the footer asks `s save · d discard` */
  confirmLeave: boolean
  /** the highest key `seq` applied; the pane drops pending keys up to it */
  ack: number
}

/** a key as `surface.onKey` hands it */
export type Key = { key: string; ctrl?: true; shift?: true; meta?: true }

export type ViewerMessage =
  | { type: 'window'; top: number }
  | { type: 'notes'; notes: Note[] }
  | { type: 'send' }
  | { type: 'close' }
  /** enter edit mode with the cursor on source line `line`; `rows`: the body's height */
  | { type: 'edit'; line: number; rows: number }
  /**
   * keys in edit mode (ctrl+s saves, ctrl+z undoes, ctrl+e leaves, the rest edits).
   * A later post in the same frame replaces an undelivered one, so the pane
   * sends EVERY key not yet acknowledged (`EditView.ack`), each with its
   * sequence number; the hooks module applies only those above the last it applied.
   */
  | { type: 'keys'; keys: { seq: number; key: Key }[]; rows: number }
  /** after a conflict: `w` overwrite (force), `r` reload the disk into the buffer */
  | { type: 'save'; force?: true }
  | { type: 'reload' }
  /** the picker's query changed (also sent once when the picker opens) */
  | { type: 'pick'; query: string }
  /** the picker chose a file (relative to the working directory, or absolute) */
  | { type: 'open'; path: string }
  /** run a search over all rows; '' clears it */
  | { type: 'search'; query: string }
