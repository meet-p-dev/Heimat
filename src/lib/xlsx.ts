/* Reading an Excel file (.xlsx) as plain rows of text, for the importers — enough for what
   Splid, Settle Up and Tricount export: every sheet, shared and inline strings, numbers,
   booleans. No formulas are worked out (the last value Excel saved is used) and no styles are
   read, so a date stored as a number arrives as that number ("45627"); the importers turn
   numbers in a date column into dates.

   An .xlsx is a zip of XML files. The zip is read here directly; its entries are inflated with
   the browser's own DecompressionStream. The iPhone app (ios-native/Heimat/Xlsx.swift) does the
   same with Apple's Compression framework, held to the same answers by the import vectors. */

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const out = new Response(new Blob([new Uint8Array(data)]).stream().pipeThrough(ds))
  return new Uint8Array(await out.arrayBuffer())
}

/* every file in the zip, by name */
export async function unzip(buf: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  // the end of central directory record: the last "PK\5\6"
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('not a zip')
  const count = u16(b, eocd + 10)
  let p = u32(b, eocd + 16)
  const files = new Map<string, Uint8Array>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('bad zip')
    const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32)
    const local = u32(b, p + 42)
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extra + comment
    if (u32(b, local) !== 0x04034b50) throw new Error('bad zip')
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
    const raw = b.subarray(start, start + size)
    if (method === 0) files.set(name, raw)
    else if (method === 8) files.set(name, await inflate(raw))
  }
  return files
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e])

/* the text of every <t> inside, in order (a rich-text string is several runs) */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('')

/* "AB12" → 27 (zero-based column) */
const colOf = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

/* a number as Excel stored it, without binary noise: "12.300000000000001" → "12.3" */
export function cleanNumber(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return String(Number(n.toPrecision(15)))
}

/* every sheet as rows of cell text, in the workbook's order */
export function sheetsFromParts(files: Map<string, Uint8Array>): string[][][] {
  const dec = new TextDecoder()
  const get = (n: string) => { const f = files.get(n); return f ? dec.decode(f) : null }
  const shared = [...(get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  // sheet order from the workbook, each sheet's file from its relationships
  const wb = get('xl/workbook.xml') || ''
  const rels = new Map([...(get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1] || '', target = /\bTarget="([^"]*)"/.exec(m[0])?.[1] || ''
    return [id, target.replace(/^\/?(xl\/)?/, 'xl/')] as [string, string]
  }))
  const paths = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => rels.get(/\br:id="([^"]*)"/.exec(m[0])?.[1] || '') || '').filter(Boolean)
  const list = paths.length ? paths : [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()
  return list.map((path) => {
    const xml = get(path) || ''
    const rows: string[][] = []
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row: string[] = []
      let next = 0
      for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], inner = cm[2] || ''
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
        const col = ref ? colOf(ref) : next
        next = col + 1
        const t = /\bt="([^"]*)"/.exec(attrs)?.[1] || 'n'
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        let text = ''
        if (t === 's') text = v != null ? shared[Number(v)] ?? '' : ''
        else if (t === 'inlineStr') text = textOf(inner)
        else if (t === 'str' || t === 'e') text = v != null ? unescapeXml(v) : ''
        else if (t === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
        else text = v != null ? cleanNumber(unescapeXml(v)) : ''
        while (row.length < col) row.push('')
        row[col] = text
      }
      rows.push(row)
    }
    return rows
  })
}

export async function readXlsx(buf: ArrayBuffer | Uint8Array): Promise<string[][][]> {
  return sheetsFromParts(await unzip(buf))
}

/* a zip file starts "PK\3\4" */
export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4
