/* Writes tests/shift-import-vectors.json from the web importer (src/lib/importShifts.ts).
   Every answer here was read and checked by hand before it was kept; the iPhone importer
   (ios-native/Heimat/ShiftImport.swift) must give the same. */
import { writeFileSync } from 'node:fs'
import { importShifts } from '../src/lib/importShifts.ts'

const have = [
  { id: 'a1', date: '2026-09-01', employer: 'Café Rot', start: '09:00', end: '17:00' },
  { id: 'a2', date: '2026-09-03', employer: 'Lab', start: '', end: '', hours: 4 },
]
const cases: [string, string][] = [
  ['own JSON export', JSON.stringify({ app: 'Heimat', exportedAt: '2026-10-02T10:00:00Z', profile: {}, shifts: [
    { id: 'a1', date: '2026-09-01', employer: 'Café Rot', start: '09:00', end: '17:00', breakMin: 30, paidBreak: false, wage: 13.9 },
    { id: 'b1', date: '2026-09-02', employer: 'Café Rot', start: '18:00', end: '23:30', breakMin: 0, paidBreak: false, wage: 13.9 },
    { id: 'b2', date: '2026-09-05', employer: 'Lab', start: '', end: '', breakMin: 0, paidBreak: false, wage: 15, hours: 3.5 },
    { id: 'b3', date: '2026-02-30', employer: 'Lab', start: '10:00', end: '12:00', breakMin: 0, paidBreak: false, wage: 15 },
  ] }, null, 2)],
  ['bare JSON list', '[{"date":"2026-09-10","employer":"Uni","start":"8:15","end":"12:45","breakMin":"15","paidBreak":"yes","wage":"14,20"}]'],
  ['own CSV export', 'Date,Employer,Start,End,Break (min),Paid break,Paid hours,Hourly wage,Gross pay\n2026-09-01,Café Rot,09:00,17:00,30,no,7.50,13.90,104.25\n2026-09-04,"Rot, Café",10:00,14:00,0,yes,4.00,13.90,55.60\n2026-09-03,Lab,,,0,no,4.00,15.00,60.00\n2026-09-06,Lab,,,0,no,2.25,15.00,33.75'],
  ['German spreadsheet', '﻿Datum;Arbeitgeber;Beginn;Ende;Pause;Stundenlohn\r\n02.09.2026;"Bäckerei; Süd";6.00;12.30;30;12,82\r\n03.09.2026;Bäckerei Süd;06:00;24:00;0;1.234,50\r\n31.09.2026;Bäckerei Süd;06:00;12:00;0;12,82\r\n04.09.2026;Bäckerei Süd;25:00;12:00;0;12,82\r\n'],
  ['tabs and duplicates', 'date\temployer\tstart\tend\twage\n2026-09-20\tShop\t10:00\t18:00\t13\n2026-09-20\tSHOP \t10:00\t18:00\t13\n2026-09-21\tShop\t\t\t13\n'],
  ['hours only', 'Date,Employer,Hours,Wage\n2026-09-22,Tutor,"1,5",20\n2026-09-03,Lab,4,15\n'],
  ['pay without a wage', 'Datum;Stunden;Brutto\n01.08.2026;5;62,50\n02.08.2026;3;abc\n'],
  ['older JSON with pay', '{"shifts":[{"id":"old1","date":"2025-12-01","employer":"Bar","hours":6,"pay":75},{"id":"old2","date":"2025-12-02","hours":2,"pay":true}]}'],
  ['no date column', 'Name,Amount\nPizza,12\nBeer,4\n'],
  ['not a timesheet', 'hello there'],
  ['broken JSON', '{"shifts": [1, 2'],
]
const out = { have, cases: cases.map(([name, text]) => ({ name, text, want: importShifts(text, have) })) }
writeFileSync(new URL('./shift-import-vectors.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
for (const c of out.cases) console.log(c.name, '→', JSON.stringify({ n: c.want.shifts.length, skipped: c.want.skipped, bad: c.want.bad }), c.want.shifts.map((s) => `${s.date} ${s.employer} ${s.start}-${s.end} b${s.breakMin}${s.paidBreak ? 'P' : ''} w${s.wage} h${s.hours} p${s.pay}`).join(' | '))
