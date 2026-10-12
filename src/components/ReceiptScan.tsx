import { Capacitor, registerPlugin } from '@capacitor/core'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { Theme } from '../lib/types'
import type { ReceiptResult } from '../lib/receipt'
import { readReceipt, itemsMatch } from '../lib/receipt'
import { pageOf } from '../lib/receiptOcr'
import type { Piece } from '../lib/receiptOcr'
import { money, relDay } from '../lib/format'
import { toMajor } from '../lib/ledger'
import { Sheet, Btn, Group, Item } from './ui'

/* What the expense form takes from a scanned receipt (iOS: ReceiptScan.swift). */
export interface ReceiptUse {
  result: ReceiptResult
  /* split it line by line (only offered when the lines add up to the total) */
  byItem: boolean
}

/* android/app/src/main/java/app/heimat/mobile/ReceiptScannerPlugin.java */
const Scanner = registerPlugin<{ scan(): Promise<{ pages: { uri: string; pieces: Piece[] }[] }> }>('ReceiptScanner')

export type ReceiptState = { kind: 'reading' } | { kind: 'failed'; why: string } | { kind: 'read'; r: ReceiptResult; steady: boolean; thumb: string | null }

/* Google's document scanner (it finds the paper, lays it flat, or takes a photo from the
   gallery), then the pages read into one receipt. Null: closed without a scan. */
export async function scanReceipt(): Promise<ReceiptState | null> {
  try {
    const { pages } = await Scanner.scan()
    if (!pages.length) return null
    let rows: string[] = [], steady = true
    for (const p of pages) {
      const pg = pageOf(p.pieces)
      rows = rows.concat(pg.rows); steady = steady && pg.steady
    }
    const r = readReceipt(rows)
    // the demo build keeps what was read, to look at from the emulator (never in a real build)
    if (import.meta.env.VITE_DEMO) Object.assign(window, { lastReceipt: { pages, rows } })
    if (r.total == null && !r.items.length) return { kind: 'failed', why: 'Lay the receipt flat in good light, with the whole of it in the photo.' }
    return { kind: 'read', r, steady, thumb: Capacitor.convertFileSrc(pages[0].uri) }
  } catch (e) {
    const code = (e as { code?: string })?.code
    return { kind: 'failed', why: code === 'unavailable' ? "This phone can't scan — Google Play services is missing or out of date." : 'Lay the receipt flat in good light, with the whole of it in the photo.' }
  }
}

/* What was read off the receipt, to check before it goes into the expense. */
export function ReceiptReview({ T, cur, state, onClose, onUse }: { T: Theme; cur: string; state: ReceiptState | null; onClose: () => void; onUse: (u: ReceiptUse) => void }) {
  const use = (u: ReceiptUse) => { onClose(); onUse(u) }
  const close = onClose
  const m = (minor: number) => money(toMajor(minor, cur), cur)

  return (
    <>
      <Sheet open={!!state} onClose={close} title="Receipt" T={T}
        footer={state?.kind === 'read' ? (() => {
          const { r, steady } = state
          // the lines add up, and came out the same however the photo's tilt was taken
          const byLine = itemsMatch(r) && steady
          return <>
            <Btn full onClick={() => use({ result: r, byItem: false })}>Split equally</Btn>
            {byLine && <Btn full kind="secondary" onClick={() => use({ result: r, byItem: true })} style={{ marginTop: 10 }}>Split line by line</Btn>}
            <div style={{ fontSize: 12.5, color: T.txt3, textAlign: 'center', marginTop: 10 }}>{byLine ? 'Line by line: tick who had what on the next screen.' : 'You can change anything on the next screen.'}</div>
          </>
        })() : state?.kind === 'failed' ? <Btn full kind="secondary" onClick={close}>Type it in instead</Btn> : undefined}>
        {state?.kind === 'reading' && <div style={{ padding: '40px 0', textAlign: 'center', color: T.txt2 }}><span className="h-spin" style={{ display: 'inline-block', marginBottom: 12 }} /><div>Reading the receipt…</div></div>}
        {state?.kind === 'failed' && (
          <div style={{ padding: '24px 8px', textAlign: 'center' }}>
            <AlertCircle size={40} color={T.txt3} />
            <div style={{ fontSize: 18, fontWeight: 650, marginTop: 10 }}>Couldn't read a total</div>
            <div style={{ fontSize: 14, color: T.txt2, marginTop: 6, lineHeight: 1.5 }}>{state.why}</div>
          </div>
        )}
        {state?.kind === 'read' && (() => {
          const { r, steady, thumb } = state
          const match = itemsMatch(r)
          return <>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
              {thumb && <img src={thumb} alt="" style={{ width: 64, height: 86, objectFit: 'cover', borderRadius: 10, flexShrink: 0, background: T.border }} />}
              <div>
                <div style={{ fontSize: 13.5, color: T.txt2 }}>Total</div>
                <div style={{ fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.total != null ? m(r.total) : 'Not found'}</div>
                {r.total != null && !r.totalSure && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: T.amber, marginTop: 2 }}><AlertCircle size={14} />Check it matches the receipt</div>}
              </div>
            </div>
            {(r.store || r.date) && <Group T={T}>
              {r.store && <Item T={T} label="Shop" value={r.store} />}
              {r.date && <Item T={T} label="Date" value={relDay(r.date)} />}
            </Group>}
            {r.items.length > 0 && (
              <Group T={T} title={`${r.items.length} ${r.items.length === 1 ? 'line' : 'lines'}`}
                footer={match && steady
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.green }}><CheckCircle2 size={14} />The lines add up to the total</span>
                  : match ? 'The photo is a little tilted, so a price may sit next to the wrong line. Split it equally — or for line by line, scan it again, flat and straight.'
                  : "Not every line could be read, so they don't add up to the total. Split it equally, or add the lines yourself."}>
                {r.items.map((it, i) => <Item key={i} T={T} label={it.name} value={<span style={{ fontVariantNumeric: 'tabular-nums' }}>{m(it.minor)}</span>} />)}
                {r.discount > 0 && <Item T={T} label="Taken off" value={<span style={{ fontVariantNumeric: 'tabular-nums' }}>−{m(r.discount)}</span>} />}
              </Group>
            )}
          </>
        })()}
      </Sheet>
    </>
  )
}
