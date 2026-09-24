import { Settings, Pencil, ShieldAlert, ShieldCheck, MailCheck, Home, Check, UserPlus, Plus, KeyRound, Globe, MapPin, ArrowRightLeft, Wallet } from 'lucide-react'
import type { Theme, Profile, Flat, AuthMode, ModalId } from '../../lib/types'
import type { RunwayCalc } from '../../lib/derive'
import { COUNTRIES, HOSTS } from '../../lib/data'
import { fixDe, rateDe } from '../../lib/format'
import { Page, Card, Btn, IconBtn, Avatar, Group, Item, Flag, TINT } from '../ui'

export default function ProfilePage({ T, profile, uid, isAnon, email, pendingEmail, myFlats, flatId, earnedTotal, spentTotal, shiftCount, runwayCalc, fH, onBack, onAuth, onSwitchFlat, setModal, onOpenSettings }: {
  T: Theme; profile: Profile; uid: string | null; isAnon: boolean; email: string | null; pendingEmail: string | null
  myFlats: Flat[]; flatId: string | null; earnedTotal: number; spentTotal: number; shiftCount: number; runwayCalc: RunwayCalc | null
  fH: (v: number) => string; onBack: () => void; onAuth: (m: AuthMode) => void; onSwitchFlat: (id: string) => void
  setModal: (m: ModalId) => void; onOpenSettings: () => void
}) {
  const homeIso = profile.homeIso || COUNTRIES.find((c) => c.n === profile.homeCountry)?.iso
  const hostIso = profile.hostIso || HOSTS.find((c) => c.n === profile.hostCountry)?.iso
  const diff = profile.homeCur !== profile.hostCur
  const stats: [string, string][] = [
    ['Earned from work', fH(earnedTotal)],
    ['Your share of flat bills', fH(spentTotal)],
    ['Shifts logged', String(shiftCount)],
    ['Flats', String(myFlats.length)],
  ]

  return (
    <Page T={T} title="Profile" onBack={onBack} right={<IconBtn label="Settings" onClick={onOpenSettings}><Settings size={20} /></IconBtn>}>
      <Card T={T} grad style={{ textAlign: 'center', padding: '24px 18px 20px', borderRadius: 30, marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', position: 'relative' }}>
          <Avatar name={profile.name} color={profile.avatar} seed={uid || profile.name} size={92} />
          <IconBtn label="Edit profile" size={34} onClick={() => setModal('profile')} style={{ position: 'absolute', right: -4, bottom: -2 }}><Pencil size={15} /></IconBtn>
        </div>
        <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.8, marginTop: 14 }}>{profile.name || 'You'}</div>
        <div style={{ marginTop: 8 }}>
          {isAnon
            ? <span className="h-pill" style={{ background: 'color-mix(in srgb, var(--amber) 16%, transparent)', color: T.amber }}><ShieldAlert size={13} /> Guest · this device only</span>
            : <span className="h-pill" style={{ background: T.accSoft, color: T.acc, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}><ShieldCheck size={13} /> {email}</span>}
        </div>
        <div style={{ fontSize: 14, color: T.txt2, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Flag iso={homeIso} size={16} /> {profile.homeCountry} <span style={{ color: T.txt3 }}>→</span> <Flag iso={hostIso} size={16} /> {profile.hostCountry}
        </div>
        <div style={{ marginTop: 16 }}><Btn size="sm" kind="secondary" icon={Pencil} onClick={() => setModal('profile')}>Edit profile</Btn></div>
      </Card>

      {isAnon && (
        <Card T={T} style={{ borderRadius: 26, marginBottom: 14, padding: 18 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="h-item-ic" style={{ background: TINT.orange, width: 40, height: 40, borderRadius: 13 }}><ShieldAlert size={20} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 750, fontSize: 16.5 }}>Don't lose your flat</div>
              <div style={{ fontSize: 13.5, color: T.txt2, marginTop: 3, lineHeight: 1.5 }}>As a guest, everything lives on this device. Create a free account so your flat and balances survive a new phone or a cleared browser.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        {stats.map(([k, v]) => (
          <Card key={k} T={T} style={{ padding: '14px 15px', borderRadius: 22 }}>
            <div style={{ fontSize: 12.5, color: T.txt3, fontWeight: 600 }}>{k}</div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.5, marginTop: 4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
          </Card>
        ))}
      </div>

      <Group T={T} title="Your flats" footer="Flats sync live with your flatmates. Everything else here stays on this device.">
        {myFlats.map((f) => (
          <Item key={f.id} T={T} icon={Home} tint={TINT.green} label={f.name} sub={f.id === flatId ? 'Current flat' : 'Tap to switch'} chevron={f.id !== flatId}
            right={f.id === flatId ? <Check size={18} color={T.acc} /> : undefined} onClick={() => onSwitchFlat(f.id)} />
        ))}
        {flatId && <Item T={T} icon={UserPlus} tint={TINT.blue} label="Invite flatmates" onClick={() => setModal('invite')} />}
        <Item T={T} icon={Plus} tint={TINT.gray} label="Create a new flat" onClick={() => setModal('create')} />
        <Item T={T} icon={KeyRound} tint={TINT.gray} label="Join with a code" onClick={() => setModal('join')} />
      </Group>

      <Group T={T} title="Home & money">
        <Item T={T} icon={Globe} tint={TINT.teal} label="Home" value={`${profile.homeCountry} · ${profile.homeCur}`} onClick={() => setModal('profile')} />
        <Item T={T} icon={MapPin} tint={TINT.indigo} label="Studying in" value={`${profile.hostCountry} · ${profile.hostCur}`} onClick={() => setModal('profile')} />
        {diff && <Item T={T} icon={ArrowRightLeft} tint={TINT.gray} label="Exchange rate" value={`1 ${profile.hostCur} = ${rateDe(profile.rate || 0)} ${profile.homeCur}`} onClick={() => setModal('profile')} />}
        <Item T={T} icon={Wallet} tint={TINT.blue} label="Funds runway" value={runwayCalc ? `${fixDe(runwayCalc.monthsLeft)} months` : 'Not set'} onClick={() => setModal('runway')} />
      </Group>

      <Group T={T}>
        <Item T={T} icon={Settings} tint={TINT.gray} label="Settings" sub="Account, appearance, notifications, limits and data" onClick={onOpenSettings} />
      </Group>
    </Page>
  )
}
