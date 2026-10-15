import { useState, useEffect } from 'react'
import { Pencil, UserPlus, Copy, Share2, Link2, Trash2, LogOut, Bell, Tag, Split, UserX } from 'lucide-react'
import type { Theme, Flat, Member } from '../../lib/types'
import { isPending, hasLeft } from '../../lib/types'
import type { Ledger } from '../../lib/ledger'
import { webOrigin, shareText, copyText } from '../../lib/native'
import { haptic } from '../../lib/haptic'
import { Page, Group, Item, Toggle, Sheet, Field, Btn, Avatar, TINT } from '../ui'

/* what a group is for: its emoji shows on its card (flats.purpose; none yet = from its kind) */
export const PURPOSES: [string, string, string][] = [
  ['home', '🏠', 'Home'], ['trip', '✈️', 'Trip'], ['couple', '💑', 'Couple'],
  ['friends', '🎉', 'Friends'], ['work', '💼', 'Work'], ['other', '✨', 'Other'],
]
export const purposeOf = (f: Flat) => f.purpose || (f.kind === 'flat' ? 'home' : 'other')
export const purposeEmoji = (f: Flat) => PURPOSES.find(([k]) => k === purposeOf(f))?.[1] || '✨'

export interface GroupActions {
  update: (name: string, purpose: string) => Promise<string | null>
  rename: (userId: string, name: string) => Promise<string | null>
  remove: (m: Member) => Promise<void>
  revoke: (memberId: string) => void
  leave: () => void
  remove_group: () => Promise<void>
  setSimplify: (on: boolean) => void
}

/* "⋯" on a group's card: its name and what it's for, everyone in it, inviting, the code,
   how debts show, and leaving or deleting it */
export default function GroupSettingsPage({ T, flat, members, uid, ledger, fH, simplified, onBack, onInvite, onCategories, onRemind, showToast, a }: {
  T: Theme; flat: Flat; members: Member[]; uid: string | null; ledger: Ledger; fH: (v: number) => string; simplified: boolean
  onBack: () => void; onInvite: () => void; onCategories: () => void; onRemind: (userId: string) => void
  showToast: (m: string) => void; a: GroupActions
}) {
  const [name, setName] = useState(flat.name)
  const [purpose, setPurpose] = useState(purposeOf(flat))
  const [busy, setBusy] = useState(false)
  const [person, setPerson] = useState<Member | null>(null)
  const [renaming, setRenaming] = useState<Member | null>(null)
  const [newName, setNewName] = useState('')
  useEffect(() => { setName(flat.name); setPurpose(purposeOf(flat)) }, [flat.id, flat.name, flat.purpose])

  const url = webOrigin()
  const people = members.filter((m) => m.flat_id === flat.id)
  const order = (m: Member) => (m.user_id === uid ? 0 : hasLeft(m) ? 3 : isPending(m) ? 2 : 1)
  const sorted = [...people].sort((x, y) => order(x) - order(y) || x.display_name.localeCompare(y.display_name))
  const net = (u: string) => ledger.net[u] || 0
  const status = (m: Member) => m.user_id === uid ? 'You' : hasLeft(m) ? 'Left' : isPending(m) ? (m.invite_email ? `Invited · ${m.invite_email}` : 'Invited by link') : 'Joined'
  const linkOf = (m: Member) => (m.invite_token ? `${url}invite.html?t=${encodeURIComponent(m.invite_token)}` : null)
  // nobody else has ever joined, or every balance is zero: deleting can't make a debt disappear
  const othersJoined = people.some((m) => m.user_id !== uid && !!m.claimed_at)
  const settled = [...ledger.books.values()].every((b) => [...b.netMinor.values()].every((v) => v === 0))
  const canDelete = !othersJoined || settled
  const dirty = name.trim() !== flat.name || purpose !== purposeOf(flat)

  const save = async () => {
    setBusy(true)
    const e = await a.update(name, purpose)
    setBusy(false)
    if (e) showToast(e); else { haptic(12); showToast('Group saved') }
  }
  const code = `${url}join.html?c=${encodeURIComponent(flat.join_code)}`
  const shareCode = async () => {
    const msg = `Join my group “${flat.name}” on Splitlife: ${code}\n(or type the code ${flat.join_code} in Splitlife → Join with code)`
    if (await shareText(msg)) return
    if (await copyText(msg)) showToast('Invite copied')
  }
  const doRename = async () => {
    if (!renaming || !newName.trim()) return
    const e = await a.rename(renaming.user_id, newName)
    if (e) { showToast(e); return }
    setRenaming(null); showToast('Name changed')
  }
  const del = async () => {
    if (!confirm(`Delete “${flat.name}”?\n\nThe group and everything in it — expenses, payments, bills, chores — is gone for everyone. This can't be undone.`)) return
    await a.remove_group()
  }

  return (
    <Page T={T} title="Group settings" onBack={onBack}>
      <Group T={T} title="Group">
        <div style={{ padding: '12px 16px 4px' }}>
          <Field T={T} label="Name" htmlFor="gs-name">
            <input id="gs-name" className="fld" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
          </Field>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.txt2, margin: '4px 2px 8px' }}>What's it for?</div>
          <div role="radiogroup" aria-label="What's it for?" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {PURPOSES.map(([k, emoji, label]) => (
              <button key={k} type="button" role="radio" aria-checked={purpose === k} onClick={() => { haptic(5); setPurpose(k) }}
                style={{ padding: '8px 12px', borderRadius: 99, border: `1.5px solid ${purpose === k ? T.acc : T.border}`, background: purpose === k ? T.accSoft : 'transparent',
                  color: purpose === k ? T.acc : T.txt, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {emoji} {label}
              </button>
            ))}
          </div>
          {dirty && <Btn full size="md" busy={busy} disabled={!name.trim()} onClick={save} style={{ marginBottom: 12 }}>Save</Btn>}
        </div>
      </Group>

      <Group T={T} title={`People · ${people.filter((m) => !hasLeft(m)).length}`} footer="Tap someone to rename them, send their link, remind them or remove them. Someone up or down has to settle up before they can be removed.">
        {sorted.map((m) => (
          <Item key={m.user_id} T={T} lead={<Avatar name={m.display_name} seed={m.user_id} size={34} />} label={m.display_name + (m.user_id === uid ? ' (you)' : '')}
            sub={status(m)} chevron
            value={Math.abs(net(m.user_id)) >= 0.005 ? <span style={{ color: net(m.user_id) > 0 ? T.green : T.red, fontWeight: 700 }}>{net(m.user_id) > 0 ? '+' : '−'}{fH(Math.abs(net(m.user_id)))}</span> : undefined}
            onClick={() => setPerson(m)} />
        ))}
        <Item T={T} icon={UserPlus} tint={TINT.green} label="Invite people" onClick={onInvite} />
      </Group>

      <Group T={T} title="Group code" footer="Anyone with the code can join from Splitlife → Join with code.">
        <Item T={T} icon={Copy} tint={TINT.blue} label={flat.join_code} sub="Copy the code" chevron={false} onClick={async () => { if (await copyText(flat.join_code)) { haptic(10); showToast('Code copied') } }} />
        <Item T={T} icon={Share2} tint={TINT.blue} label="Share an invite" onClick={shareCode} />
      </Group>

      <Group T={T} title="Money">
        <Item T={T} icon={Split} tint={TINT.purple} label="Simplify debts" sub="Fewer payments for everyone" chevron={false}
          right={<Toggle label="Simplify debts" on={simplified} onChange={a.setSimplify} />} />
        <Item T={T} icon={Tag} tint={TINT.orange} label="Categories" onClick={onCategories} />
      </Group>

      <Group T={T} footer={canDelete ? 'Deleting removes the group and everything in it for everyone.' : 'A group can be deleted once everyone is settled up — or while nobody else has joined.'}>
        <Item T={T} icon={LogOut} tint={TINT.red} label={`Leave “${flat.name}”`} danger chevron={false} onClick={a.leave} />
        <Item T={T} icon={Trash2} tint={TINT.red} label="Delete group" danger chevron={false} disabled={!canDelete} onClick={del} />
      </Group>

      <Sheet open={!!person} onClose={() => setPerson(null)} title={person ? person.display_name : ''} T={T}>
        {person && (() => {
          const m = person, me = m.user_id === uid, waiting = isPending(m) && !hasLeft(m)
          const link = linkOf(m), n = net(m.user_id)
          return (
            <Group T={T} footer={me ? undefined : !waiting && !hasLeft(m) ? 'Only they can change the name they go by.' : undefined}>
              {(me || waiting) && <Item T={T} icon={Pencil} tint={TINT.blue} label={me ? 'Change your name here' : 'Rename'} onClick={() => { setNewName(m.display_name); setRenaming(m); setPerson(null) }} />}
              {waiting && link && <Item T={T} icon={Link2} tint={TINT.green} label="Copy their invite link" chevron={false} onClick={async () => { if (await copyText(link)) showToast(`Link for ${m.display_name} copied`); setPerson(null) }} />}
              {!me && !hasLeft(m) && n < -0.005 && <Item T={T} icon={Bell} tint={TINT.orange} label={`Remind them · ${fH(-n)}`} chevron={false} onClick={() => { onRemind(m.user_id); setPerson(null) }} />}
              {!me && !hasLeft(m) && <Item T={T} icon={UserX} tint={TINT.red} danger chevron={false} label={waiting ? 'Withdraw invite' : `Remove from ${flat.name}`}
                onClick={async () => {
                  if (!confirm(waiting ? `Withdraw ${m.display_name}'s invite?` : `Remove ${m.display_name} from “${flat.name}”?`)) return
                  setPerson(null)
                  if (waiting && m.id) a.revoke(m.id); else await a.remove(m)
                }} />}
              {me && <Item T={T} icon={LogOut} tint={TINT.red} danger chevron={false} label="Leave the group" onClick={() => { setPerson(null); a.leave() }} />}
            </Group>
          )
        })()}
      </Sheet>

      <Sheet open={!!renaming} onClose={() => setRenaming(null)} title={renaming?.user_id === uid ? 'Your name in this group' : `Rename ${renaming?.display_name || ''}`} T={T}
        footer={<Btn full disabled={!newName.trim()} onClick={doRename}>Save</Btn>}>
        <Field T={T} label="Name" htmlFor="gs-person">
          <input id="gs-person" className="fld" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doRename() }} />
        </Field>
      </Sheet>
    </Page>
  )
}
