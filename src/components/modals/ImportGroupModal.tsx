import { useState, useEffect } from 'react'
import { Upload, CheckCircle2, AlertCircle, Trash2, ChevronLeft } from 'lucide-react'
import type { Theme } from '../../lib/types'
import { sb } from '../../lib/supabase'
import { money } from '../../lib/format'
import { toMajor } from '../../lib/ledger'
import { importCsv, importTable, importSheets, csvTable, guessMe, importPayload, fileHash, swSummary,
  type SwFile, type ColumnMap, type Source } from '../../lib/importExpenses'
import { readXlsx, isZip } from '../../lib/xlsx'
import { Sheet, Field, Btn, Group, Item, SegmentedControl, CheckCircle, Avatar, Alert, TINT } from '../ui'

/* the apps people come from, and how to get the file out of each — what their help pages and
   users describe; "other" is any spreadsheet */
export const APPS: { id: Source; name: string; steps: string[] }[] = [
  { id: 'splitwise', name: 'Splitwise', steps: ['Open the group', 'Settings → Export as spreadsheet', 'Save the CSV file, then pick it here'] },
  { id: 'tricount', name: 'Tricount', steps: ['Open the tricount', 'Look for Export in its settings (Excel or CSV)', 'No export in your app? Tricount support can send you the file'] },
  { id: 'settleup', name: 'Settle Up', steps: ['Open the group', 'Menu → Export — it emails you a CSV (Excel with Premium)', 'Save the file, then pick it here'] },
  { id: 'splid', name: 'Splid', steps: ['Open the group', 'Export → Excel', 'Save the file, then pick it here'] },
  { id: 'other', name: 'A spreadsheet', steps: ['Any CSV or Excel file with a date, an amount and who paid', "If its columns aren't recognised, you pick which is which"] },
]
/* "Splitwise", "a spreadsheet" — mid-sentence */
export const appName = (s: Source | null) => (s === 'other' ? 'a spreadsheet' : APPS.find((a) => a.id === s)?.name || 'another app')

const ERRORS: Record<string, string> = {
  empty: 'There are no expenses in that file.',
  too_large: 'That group has more than 5,000 expenses — too many to bring over in one go.',
  unreadable: "That file couldn't be opened. Pick a CSV or Excel (.xlsx) file.",
}
const SERVER: Record<string, string> = {
  already: "You've already imported this file — it's in your groups.",
  balances_differ: "Something didn't add up, so nothing was imported. Nothing has changed.",
  too_many: "That's a lot of imports for one day — try again tomorrow.",
  pick_yourself: 'Pick which one is you.',
}
const FIELDS: [keyof ColumnMap, string, boolean][] = [
  ['date', 'Date', true], ['amount', 'Amount', true], ['payer', 'Who paid', true], ['description', 'Description', false],
  ['forWhom', 'For whom (empty: everyone)', false], ['currency', 'Currency', false], ['category', 'Category', false],
]
const month = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
const EMPTY_MAP: ColumnMap = { date: -1, description: -1, amount: -1, payer: -1, forWhom: -1, currency: -1, category: -1 }
const filled = (r: string[]) => r.some((c) => c.trim())

/* Bringing a group over from another app: which app, pick the export, check what's in it,
   say which one is you */
export default function ImportGroupModal({ open, onClose, T, myName, currency, onImported }: {
  open: boolean; onClose: () => void; T: Theme; myName: string; currency: string
  onImported: (flatId: string, name: string, others: number) => void
}) {
  const [source, setSource] = useState<Source | null>(null)
  const [file, setFile] = useState<SwFile | null>(null)
  const [table, setTable] = useState<string[][] | null>(null)   // a file whose columns someone picks
  const [fileName, setFileName] = useState('')
  const [map, setMap] = useState<ColumnMap>(EMPTY_MAP)
  const [hash, setHash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'group' | 'flat'>('group')
  const [busy, setBusy] = useState(false)
  const reset = () => { setFile(null); setTable(null); setError(null); setMe(null); setName(''); setKind('group'); setBusy(false); setMap(EMPTY_MAP) }
  useEffect(() => { if (open) { reset(); setSource(null) } }, [open])

  const got = (f: SwFile) => { setError(null); setTable(null); setFile(f); setName(f.name); setMe(guessMe(f.people, myName)) }

  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      if (f.size > 10_000_000) { setError('That file is too big.'); return }
      reset(); setFileName(f.name)
      const bytes = new Uint8Array(await f.arrayBuffer())
      const opts = { fileName: f.name, currency }
      try {
        if (isZip(bytes)) {
          const sheets = await readXlsx(bytes)
          setHash(await fileHash(bytes))
          const r = importSheets(sheets, opts)
          if (r.ok) return got(r.file)
          if (r.error !== 'not_recognised') { setError(ERRORS[r.error]); return }
          // columns are picked on the sheet with the most rows
          setTable(sheets.reduce((a, s) => (s.filter(filled).length > a.filter(filled).length ? s : a), sheets[0] || []))
        } else {
          let text = new TextDecoder('utf-8').decode(bytes)
          if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes)
          setHash(await fileHash(text))
          const r = importCsv(text, opts)
          if (r.ok) return got(r.file)
          if (r.error !== 'not_recognised') { setError(ERRORS[r.error]); return }
          setTable(csvTable(text))
        }
      } catch { setError(ERRORS.unreadable) }
    }
    input.click()
  }

  const readMapped = () => {
    if (!table) return
    const r = importTable(table, { fileName, currency, map })
    if (r.ok) got(r.file)
    else setError(r.error === 'not_recognised' ? "Those columns didn't give any expenses — check which is which." : ERRORS[r.error])
  }

  const run = async () => {
    if (!file || me == null || !sb || !source) return
    setBusy(true); setError(null)
    const { data, error: e } = await sb.rpc('import_group', { p: importPayload(file, me, name, kind, hash, source) })
    setBusy(false)
    if (e) {
      const code = /^import: (\w+)/.exec(e.message || '')?.[1]
      setError((code && SERVER[code]) || "Couldn't import — check your connection and try again.")
      return
    }
    const flat = (data as { flat: { id: string; name: string } }).flat
    onImported(flat.id, flat.name, file.people.length - 1)
  }

  const app = APPS.find((a) => a.id === source)
  const lines = file ? file.people.flatMap((p) => file.currencies.map((cur) => ({ p, cur, minor: file.balances[`${p.key}|${cur}`] || 0 }))).filter((l) => l.minor) : []
  const head = table ? (table.find(filled) || []) : []
  const footer = file ? <Btn full busy={busy} disabled={me == null} onClick={run}>{me == null ? 'Pick which one is you' : `Import ${swSummary(file)}`}</Btn>
    : table ? <Btn full disabled={FIELDS.some(([k, , req]) => req && map[k] < 0)} onClick={readMapped}>Read the file</Btn> : undefined

  return (
    <Sheet open={open} onClose={onClose} title={source ? `Import from ${appName(source)}` : 'Import a group'} T={T} footer={footer}>
      {!source && <>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: T.txt2, margin: '0 0 14px' }}>
          Bring a group over with every expense and payment, on its original date — balances stay exactly as they were.
        </p>
        <Group T={T} title="Where from?">
          {APPS.map((a) => <Item key={a.id} T={T} label={a.name} onClick={() => setSource(a.id)} />)}
        </Group>
      </>}

      {app && !file && !table && <>
        <Group T={T} title={app.id === 'other' ? 'What works' : `In ${app.name}`}>
          {app.steps.map((s, i) => <Item key={i} T={T} label={app.id === 'other' ? s : `${i + 1}. ${s}`} chevron={false} />)}
        </Group>
        {error && <Alert T={T}>{error}</Alert>}
        <Btn full icon={Upload} onClick={pick} style={{ marginTop: 12 }}>Choose the file</Btn>
        <Btn full kind="ghost" icon={ChevronLeft} onClick={() => { reset(); setSource(null) }} style={{ marginTop: 6 }}>Another app</Btn>
        <p style={{ fontSize: 13, color: T.txt3, margin: '12px 2px 0', lineHeight: 1.45 }}>The file is read on this device. Only the expenses go to your new group.</p>
      </>}

      {table && !file && <>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: T.txt2, margin: '0 0 12px' }}>Which column is what? Splitlife didn't recognise this file's columns.</p>
        <Group T={T}>
          {FIELDS.map(([k, label, req]) => (
            <Item key={k} T={T} label={label} chevron={false} right={
              <select className="fld" aria-label={label} value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })} style={{ maxWidth: 170, padding: '6px 8px', minHeight: 0 }}>
                <option value={-1}>{req ? 'Choose…' : '—'}</option>
                {head.map((h, i) => <option key={i} value={i}>{h.trim() || `Column ${i + 1}`}</option>)}
              </select>
            } />
          ))}
        </Group>
        {error && <Alert T={T}>{error}</Alert>}
      </>}

      {file && <>
        <Field T={T} label="Name" htmlFor="ig-name">
          <input id="ig-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" maxLength={60} />
        </Field>
        <Field T={T} label="It's a">
          <SegmentedControl T={T} label="Group or flat" value={kind} onChange={setKind} options={[['group', 'Group'], ['flat', 'Flat']]} />
        </Field>

        <Group T={T} title="Which one is you?" footer="Everyone else is added waiting to join. Send each of them their invite link from the group — they take over their name and see the whole history.">
          {file.people.map((p) => (
            <Item key={p.key} T={T} lead={<Avatar name={p.name} seed={p.name} size={34} />} label={p.name} chevron={false}
              right={<CheckCircle on={me === p.key} />} onClick={() => setMe(p.key)} />
          ))}
        </Group>

        <Group T={T} title={swSummary(file)} footer={file.from && file.to ? `${month(file.from)}${file.from.slice(0, 7) !== file.to.slice(0, 7) ? ` – ${month(file.to)}` : ''}` : undefined}>
          {lines.length === 0 && <Item T={T} label="Everyone is settled up" chevron={false} />}
          {lines.map((l) => (
            <Item key={l.p.key + l.cur} T={T} label={l.p.key === me ? 'You' : l.p.name} chevron={false}
              sub={l.minor > 0 ? 'gets back' : 'owes'}
              value={<span style={{ color: l.minor > 0 ? T.green : T.red, fontWeight: 700 }}>{money(toMajor(Math.abs(l.minor), l.cur), l.cur)}</span>} />
          ))}
        </Group>

        {file.totals === 'yes' && <Item T={T} icon={CheckCircle2} tint={TINT.green} label="Matches the file's own totals" chevron={false} />}
        {file.totals === 'rounding' && <Alert T={T} tone="amber">Within a few cents of the file's totals — Splitwise rounds its total row.</Alert>}
        {file.totals === 'no' && <Alert T={T} tone="amber">These balances differ from the total row in the file. Check them before importing.</Alert>}
        {file.totals === 'none' && <p style={{ fontSize: 13, color: T.txt3, margin: '10px 2px', lineHeight: 1.45 }}>Check these balances against {source === 'other' ? 'your spreadsheet' : appName(source)} before importing.</p>}
        {(file.bad.length > 0 || file.skipped > 0) && (
          <p style={{ display: 'flex', gap: 8, fontSize: 13, color: T.txt3, margin: '10px 2px', lineHeight: 1.45 }}>
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              {file.bad.length > 0 && `${file.bad.length} row${file.bad.length === 1 ? '' : 's'} couldn't be read and ${file.bad.length === 1 ? 'was' : 'were'} left out (line ${file.bad.slice(0, 5).join(', ')}${file.bad.length > 5 ? '…' : ''}). `}
              {file.skipped > 0 && `${file.skipped} row${file.skipped === 1 ? '' : 's'} didn't change anyone's balance and ${file.skipped === 1 ? 'was' : 'were'} left out.`}
            </span>
          </p>
        )}
        {error && <Alert T={T}>{error}</Alert>}
      </>}
    </Sheet>
  )
}

/* Settings → Export & import: imports you can still take back (until someone else joins) */
export function GroupImports({ T, uid, names, onRemoved, showToast }: {
  T: Theme; uid: string | null; names: Record<string, string>; onRemoved: () => void; showToast: (m: string) => void
}) {
  const [rows, setRows] = useState<{ id: string; flat_id: string; source: Source; expenses: number; payments: number }[]>([])
  const load = () => { if (sb && uid) sb.from('imports').select('id, flat_id, source, expenses, payments').order('created_at', { ascending: false }).then(({ data }) => setRows(((data as typeof rows) || []).filter((r) => r.flat_id))) }
  useEffect(load, [uid])
  if (!rows.length) return null
  const remove = async (r: (typeof rows)[number]) => {
    const nm = names[r.flat_id] || 'this group'
    if (!confirm(`Remove “${nm}”?\n\nThe group and everything in it goes — the ${r.expenses} imported expenses and anything added since. You can import the file again later.`)) return
    const { error } = await sb!.rpc('remove_import', { p_import: r.id })
    if (error) {
      showToast(/someone_joined/.test(error.message) ? 'Someone has joined that group, so it stays — you can leave it instead' : "Couldn't remove it — try again")
      return
    }
    load(); onRemoved(); showToast(`Removed ${nm}`)
  }
  return (
    <Group T={T} title="Imported groups" footer="You can take an import back until someone else joins the group.">
      {rows.map((r) => (
        <Item key={r.id} T={T} icon={Trash2} tint={TINT.red} label={`Remove ${names[r.flat_id] || 'group'}`}
          sub={[`from ${appName(r.source)}`, r.expenses && `${r.expenses} expense${r.expenses === 1 ? '' : 's'}`, r.payments && `${r.payments} payment${r.payments === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          chevron={false} onClick={() => remove(r)} />
      ))}
    </Group>
  )
}
