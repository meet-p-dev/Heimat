import { useState, useEffect } from 'react'
import { Upload, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react'
import type { Theme } from '../../lib/types'
import { sb } from '../../lib/supabase'
import { money } from '../../lib/format'
import { toMajor } from '../../lib/ledger'
import { importSplitwise, guessMe, importPayload, fileHash, swSummary, type SwFile } from '../../lib/importSplitwise'
import { Sheet, Field, Btn, Group, Item, SegmentedControl, CheckCircle, Avatar, Alert, TINT } from '../ui'

const ERRORS: Record<string, string> = {
  not_splitwise: "That doesn't look like a Splitwise export. In Splitwise, export the group as a spreadsheet (CSV) and pick that file.",
  empty: 'There are no expenses in that file.',
  too_large: 'That group has more than 5,000 expenses — too many to bring over in one go.',
}
const SERVER: Record<string, string> = {
  already: "You've already imported this file — it's in your groups.",
  balances_differ: "Something didn't add up, so nothing was imported. Nothing has changed.",
  too_many: "That's a lot of imports for one day — try again tomorrow.",
  pick_yourself: 'Pick which one is you.',
}
const month = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

/* Bringing a group over from Splitwise: pick the export, check what's in it, say which one is you */
export default function SplitwiseImportModal({ open, onClose, T, myName, onImported }: {
  open: boolean; onClose: () => void; T: Theme; myName: string
  onImported: (flatId: string, name: string, others: number) => void
}) {
  const [file, setFile] = useState<SwFile | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'group' | 'flat'>('group')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setFile(null); setText(''); setError(null); setMe(null); setName(''); setKind('group'); setBusy(false) } }, [open])

  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.txt,text/csv,text/plain'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      if (f.size > 10_000_000) { setError('That file is too big.'); return }
      const t = await f.text()
      const r = importSplitwise(t, f.name)
      if (!r.ok) { setFile(null); setError(ERRORS[r.error]); return }
      setError(null); setText(t); setFile(r.file); setName(r.file.name); setMe(guessMe(r.file.people, myName))
    }
    input.click()
  }

  const run = async () => {
    if (!file || me == null || !sb) return
    setBusy(true); setError(null)
    const { data, error: e } = await sb.rpc('import_group', { p: importPayload(file, me, name, kind, await fileHash(text)) })
    setBusy(false)
    if (e) {
      const code = /^import: (\w+)/.exec(e.message || '')?.[1]
      setError((code && SERVER[code]) || "Couldn't import — check your connection and try again.")
      return
    }
    const flat = (data as { flat: { id: string; name: string } }).flat
    onImported(flat.id, flat.name, file.people.length - 1)
  }

  // everyone's balance from the file, per currency: who gets money back, who owes
  const lines = file ? file.people.flatMap((p) => file.currencies.map((cur) => ({ p, cur, minor: file.balances[`${p.key}|${cur}`] || 0 }))).filter((l) => l.minor) : []
  const footer = file && <Btn full busy={busy} disabled={me == null} onClick={run}>{me == null ? 'Pick which one is you' : `Import ${swSummary(file)}`}</Btn>

  return (
    <Sheet open={open} onClose={onClose} title="Import from Splitwise" T={T} footer={footer || undefined}>
      {!file && <>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: T.txt2, margin: '0 0 14px' }}>
          Bring a group over with every expense and payment, on its original date — balances stay exactly as they were.
        </p>
        <Group T={T} title="In Splitwise">
          <Item T={T} label="1. Open the group" chevron={false} />
          <Item T={T} label="2. Settings → Export as spreadsheet" sub="On splitwise.com it's under the group's settings" chevron={false} />
          <Item T={T} label="3. Save the CSV file, then pick it here" chevron={false} />
        </Group>
        {error && <Alert T={T}>{error}</Alert>}
        <Btn full icon={Upload} onClick={pick} style={{ marginTop: 12 }}>Choose the file</Btn>
        <p style={{ fontSize: 13, color: T.txt3, margin: '12px 2px 0', lineHeight: 1.45 }}>The file is read on this device. Only the expenses go to your new group.</p>
      </>}

      {file && <>
        <Field T={T} label="Name" htmlFor="sw-name">
          <input id="sw-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="From Splitwise" maxLength={60} />
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

        {file.totals === 'yes' && <Item T={T} icon={CheckCircle2} tint={TINT.green} label="Matches Splitwise's own totals" chevron={false} />}
        {file.totals === 'rounding' && <Alert T={T} tone="amber">Within a few cents of Splitwise's totals — Splitwise rounds its total row.</Alert>}
        {file.totals === 'no' && <Alert T={T} tone="amber">These balances differ from the total row in the file. Check them before importing.</Alert>}
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
export function SplitwiseImports({ T, uid, names, onRemoved, showToast }: {
  T: Theme; uid: string | null; names: Record<string, string>; onRemoved: () => void; showToast: (m: string) => void
}) {
  const [rows, setRows] = useState<{ id: string; flat_id: string; expenses: number; payments: number }[]>([])
  const load = () => { if (sb && uid) sb.from('imports').select('id, flat_id, expenses, payments').order('created_at', { ascending: false }).then(({ data }) => setRows(((data as typeof rows) || []).filter((r) => r.flat_id))) }
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
    <Group T={T} title="Imported from Splitwise" footer="You can take an import back until someone else joins the group.">
      {rows.map((r) => (
        <Item key={r.id} T={T} icon={Trash2} tint={TINT.red} label={`Remove ${names[r.flat_id] || 'group'}`} sub={[r.expenses && `${r.expenses} expense${r.expenses === 1 ? '' : 's'}`, r.payments && `${r.payments} payment${r.payments === 1 ? '' : 's'}`].filter(Boolean).join(', ')} chevron={false} onClick={() => remove(r)} />
      ))}
    </Group>
  )
}
