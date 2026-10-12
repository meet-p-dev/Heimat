import { Pencil, ShieldAlert, MailCheck, Home, Users, PlusCircle, KeyRound, ChevronRight } from 'lucide-react'
import type { Theme, Profile, Flat, AuthMode, ModalId } from '../../lib/types'
import { COUNTRIES, HOSTS } from '../../lib/data'
import { money } from '../../lib/format'
import { Page, Card, Btn, IconBtn, Avatar, Group, Item, Flag, TINT } from '../ui'

/* a group with how many people are in it and where you stand */
export interface GroupLine { flat: Flat; people: number; simplified: boolean; minor: number; major: number; currency: string }

/* Who you are and your account: the avatar button top right, or the card at the top of
   Settings. How the app behaves lives in Settings; nothing is in both (iOS: ProfileView). */
export default function ProfilePage({ T, profile, uid, isAnon, email, pendingEmail, groups, spentTotal, earnedTotal, showEarned, fH, onBack, onAuth, onOpenGroup, setModal, onSignOut, onDeleteAccount }: {
  T: Theme; profile: Profile; uid: string | null; isAnon: boolean; email: string | null; pendingEmail: string | null
  groups: GroupLine[]; spentTotal: number; earnedTotal: number; showEarned: boolean
  fH: (v: number) => string; onBack: () => void; onAuth: (m: AuthMode) => void; onOpenGroup: (id: string) => void
  setModal: (m: ModalId) => void; onSignOut: () => void; onDeleteAccount: () => void
}) {
  const homeIso = profile.homeIso || COUNTRIES.find((c) => c.n === profile.homeCountry)?.iso
  const hostIso = profile.hostIso || HOSTS.find((c) => c.n === profile.hostCountry)?.iso
  const edit = () => setModal('profile')
  const stats: [string, string][] = [
    [String(groups.length), groups.length === 1 ? 'Group' : 'Groups'],
    [fH(spentTotal), 'Your share'],
    ...(showEarned ? [[fH(earnedTotal), 'Earned'] as [string, string]] : []),
  ]

  return (
    <Page T={T} title="Profile" onBack={onBack} z={215} right={<IconBtn label="Edit profile" onClick={edit}><Pencil size={19} /></IconBtn>}>
      {/* avatar (tap to change it), name, email, where you're from and where you live */}
      <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
        <button type="button" onClick={edit} aria-label="Edit profile" className="h-press" style={{ display: 'inline-flex', position: 'relative', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <Avatar name={profile.name} color={profile.avatar} seed={uid || profile.name} size={96} />
          <span style={{ position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.card, color: T.txt, border: `2.5px solid ${T.bg}` }}><Pencil size={14} /></span>
        </button>
        <div style={{ fontSize: 24, fontWeight: 750, marginTop: 12 }}>{profile.name || 'You'}</div>
        {isAnon
          ? <span className="h-pill" style={{ marginTop: 6, background: 'color-mix(in srgb, var(--amber) 16%, transparent)', color: T.amber }}><ShieldAlert size={13} /> Guest · this phone only</span>
          : email && <div style={{ fontSize: 14.5, color: T.txt2, marginTop: 3 }}>{email}</div>}
        <div style={{ fontSize: 13, color: T.txt2, marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Flag iso={homeIso} size={15} /> {profile.homeCountry} <span style={{ color: T.txt3 }}>→</span> <Flag iso={hostIso} size={15} /> {profile.hostCountry}
        </div>
      </div>

      {isAnon && (
        <Card T={T} style={{ borderRadius: 24, marginBottom: 14, padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="h-item-ic" style={{ background: TINT.orange }}><ShieldAlert size={17} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 16 }}>Keep your groups safe</div>
              <div style={{ fontSize: 13.5, color: T.txt2, marginTop: 3, lineHeight: 1.5 }}>As a guest, everything lives on this phone. A free account keeps your groups and balances on a new phone or after a reinstall.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn size="md" onClick={() => onAuth('signup')} style={{ flex: 1 }}>Create account</Btn>
            <Btn size="md" kind="secondary" onClick={() => onAuth('signin')} style={{ flex: 1 }}>Sign in</Btn>
          </div>
        </Card>
      )}

      {pendingEmail && (
        <Card T={T} style={{ borderRadius: 22, marginBottom: 14, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <MailCheck size={22} color={T.acc} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 13.5, color: T.txt2, lineHeight: 1.5 }}>Confirm <b style={{ color: T.txt }}>{pendingEmail}</b> — open the link we sent to finish.</div>
        </Card>
      )}

      {/* three numbers side by side, the way a profile shows them */}
      <div className="glass" style={{ borderRadius: 22, display: 'flex', padding: '12px 0', marginBottom: 24 }}>
        {stats.map(([v, k], i) => (
          <div key={k} style={{ flex: 1, minWidth: 0, textAlign: 'center', borderLeft: i ? `1px solid ${T.border}` : 'none', padding: '0 6px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
            <div style={{ fontSize: 12, color: T.txt3, marginTop: 2 }}>{k}</div>
          </div>
        ))}
      </div>

      <Group T={T} title="Personal info" footer="People in your groups see your name and colour.">
        <Item T={T} label="Name" value={profile.name || 'Add your name'} onClick={edit} />
        <Item T={T} label="Home country" value={profile.homeCountry} onClick={edit} />
        <Item T={T} label="Living in" value={profile.hostCountry} onClick={edit} />
        <Item T={T} label="Currency" value={profile.homeCur === profile.hostCur ? profile.hostCur : `${profile.hostCur} · home ${profile.homeCur}`} onClick={edit} />
      </Group>

      <Group T={T} title="Your groups">
        {groups.map((g) => (
          <button key={g.flat.id} type="button" className="h-item" onClick={() => onOpenGroup(g.flat.id)} style={{ '--inset': '61px' } as React.CSSProperties}>
            <span className="h-item-ic" style={{ background: g.flat.kind === 'flat' ? TINT.green : TINT.blue }}>{g.flat.kind === 'flat' ? <Home size={17} /> : <Users size={17} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.flat.name}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: T.txt3 }}>{g.people} {g.people === 1 ? 'person' : 'people'}{g.simplified ? ' · simplified' : ''}</span>
            </span>
            <span style={{ textAlign: 'right', flexShrink: 0 }}>
              {g.minor === 0
                ? <span style={{ fontSize: 14, color: T.txt3 }}>Settled</span>
                : <>
                  <span style={{ display: 'block', fontSize: 12, color: T.txt3 }}>{g.minor > 0 ? 'you get' : 'you owe'}</span>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: g.minor > 0 ? T.green : T.amber }}>{money(Math.abs(g.major), g.currency)}</span>
                </>}
            </span>
            <ChevronRight size={17} color={T.txt3} style={{ flexShrink: 0 }} />
          </button>
        ))}
        <Item T={T} icon={PlusCircle} tint={TINT.green} label="New group" chevron={false} onClick={() => setModal('create')} />
        <Item T={T} icon={KeyRound} tint={TINT.gray} label="Join with a code" chevron={false} onClick={() => setModal('join')} />
      </Group>

      {!isAnon && (
        <>
          <Group T={T} title="Sign-in & security" footer={pendingEmail ? `Waiting for you to confirm ${pendingEmail}.` : undefined}>
            <Item T={T} label="Email" value={email} onClick={() => onAuth('email')} />
            <Item T={T} label="Password" value="Change" onClick={() => onAuth('password')} />
          </Group>
          <Group T={T}>
            <button type="button" className="h-item" onClick={onSignOut} style={{ justifyContent: 'center', color: T.red, fontWeight: 600 }}>Sign out</button>
          </Group>
        </>
      )}

      <Group T={T} footer="Leaves every group and removes everything stored about you on the server. Shared expenses stay with the group, without your name. This cannot be undone.">
        <button type="button" className="h-item" onClick={onDeleteAccount} style={{ justifyContent: 'center', color: T.red, fontWeight: 600 }}>Delete account</button>
      </Group>
    </Page>
  )
}
