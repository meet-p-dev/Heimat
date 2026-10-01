import { useState } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import type { Theme, Profile } from '../lib/types'
import { SHARES, DOINGS, PARTS, partOn, withPart, withAnswers } from '../lib/life'
import { haptic } from '../lib/haptic'
import { Sheet, Group, Item, Toggle, Btn, TINT } from './ui'

/* Tick-boxes for one question: a row each (onboarding and Settings). */
export function LifeChoices({ T, options, chosen, set }: {
  T: Theme; options: [string, string][]; chosen: string[]; set: (v: string[]) => void
}) {
  return (
    <div className="h-well" style={{ padding: 0 }}>
      {options.map(([id, label], i) => {
        const on = chosen.includes(id)
        return (
          <button key={id} type="button" role="checkbox" aria-checked={on}
            onClick={() => { haptic(8); set(on ? chosen.filter((x) => x !== id) : [...chosen, id]) }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 16px', background: 'none', border: 'none', borderTop: i ? `1px solid ${T.border}` : 'none', color: T.txt, font: 'inherit', fontSize: 16, textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ width: 24, height: 24, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? T.acc : 'transparent', border: on ? 'none' : `2px solid ${T.border}`, color: '#fff' }}>
              {on && <Check size={15} strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export const LifeQuestions = ({ T, share, doing, setShare, setDoing }: {
  T: Theme; share: string[]; doing: string[]; setShare: (v: string[]) => void; setDoing: (v: string[]) => void
}) => (
  <>
    <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, margin: '0 4px 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>Who do you share costs with?</div>
    <LifeChoices T={T} options={SHARES} chosen={share} set={setShare} />
    <div style={{ fontSize: 12.5, color: T.txt3, margin: '8px 4px 22px' }}>Pick all that fit — or none if you live on your own.</div>
    <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, margin: '0 4px 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>What do you do?</div>
    <LifeChoices T={T} options={DOINGS} chosen={doing} set={setDoing} />
  </>
)

/* Settings → Your Splitlife: the questions again, and every part with its switch. */
export function LifeSettingsItem({ T, profile, sProfile }: { T: Theme; profile: Profile; sProfile: (p: Profile) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Item T={T} icon={SlidersHorizontal} tint={TINT.indigo} label="Your Splitlife" sub="Who you share with, what you do, what the app shows" onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Your Splitlife" T={T}>
        <LifeQuestions T={T} share={profile.share || []} doing={profile.doing || []}
          setShare={(v) => sProfile(withAnswers(profile, 'share', v))} setDoing={(v) => sProfile(withAnswers(profile, 'doing', v))} />
        <div style={{ height: 22 }} />
        <Group T={T} title="Show in the app" footer="Hiding a part never deletes anything — switch it back on and it is all there.">
          {PARTS.map(([part, label, sub]) => (
            <Item key={part} T={T} label={label} sub={sub}
              right={<Toggle label={label} on={partOn(profile, part)} onChange={(v) => sProfile(withPart(profile, part, v))} />} />
          ))}
        </Group>
        {profile.parts && <Btn full kind="secondary" onClick={() => sProfile({ ...profile, parts: undefined })}>Show what fits me</Btn>}
      </Sheet>
    </>
  )
}
