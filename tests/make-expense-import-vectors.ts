/* Writes tests/expense-import-vectors.json from the web importer (src/lib/importExpenses.ts and
   src/lib/xlsx.ts). Every answer here was read and checked by hand before it was kept; the
   iPhone importer (ios-native/Heimat/ExpenseImport.swift, Xlsx.swift) must give the same.
   Made-up people only. The layouts of Tricount, Settle Up and Splid follow what is published
   about them (sesterce.io/docs/import, settle-up exports shared by users); Splitwise's is its
   own documented export. */
import { writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { importCsv, importSheets, type ColumnMap, type ReadOpts } from '../src/lib/importExpenses.ts'
import { readXlsx } from '../src/lib/xlsx.ts'

const csv: [string, string, string, ReadOpts?][] = [
  // ---- Splitwise (one column per person: paid minus owed)
  ['splitwise: flat in euros', 'sunny-wg_2025-05-03_export.csv',
    'Date,Description,Category,Cost,Currency,Alex Kim,Priya Nair,Tom Berg\n' +
    '2025-03-01,Rewe,Groceries,30.00,EUR,20.00,-10.00,-10.00\n' +
    '2025-03-02,Rent March,Rent,900.00,EUR,300.00,0.00,-300.00\n' +
    '2025-03-04,Priya N. paid Alex K.,Payment,10.00,EUR,-10.00,10.00,0.00\n' +
    '2025-03-05,Pizza,Dining out,10.00,EUR,6.67,-3.33,-3.34\n' +
    '2025-03-06,"Döner, Club Mate",General,12.00,EUR,0.00,0.00,0.00\n' +
    '\n' +
    ',Total balance, , ,EUR,316.67,-3.33,-313.34\n'],
  ['splitwise: trip in three currencies', 'Lisbon trip_2025-08-20_export.csv',
    'Date,Description,Category,Cost,Currency,Priya,Sam,Lena\n' +
    '2025-08-01,Hotel,Hotel,300.00,EUR,100.00,100.00,-200.00\n' +
    '2025-08-02,Train tickets,Bus/train,3000.00,JPY,2000.00,-1000.00,-1000.00\n' +
    '2025-08-03,Uber,Taxi,25.50,USD,-12.75,12.75,0.00\n' +
    '2025-08-04,Lena paid Priya,Payment,50.00,EUR,-50.00,0.00,50.00\n' +
    '\n' +
    ',Total balance,,,EUR,50.00,100.00,-150.00\n' +
    ',Total balance,,,JPY,2000.00,-1000.00,-1000.00\n' +
    ',Total balance,,,USD,-12.75,12.75,0.00\n'],
  ['splitwise: odd rows', 'export.csv',
    'Date,Description,Category,Cost,Currency,Me,You\n' +
    '2024-12-24,Gift return,Gifts,-40.00,EUR,-20.00,20.00\n' +
    '2024-12-25,Broken,General,10.00,EUR,5.00,-4.00\n' +
    '2024-13-01,Bad date,General,10.00,EUR,5.00,-5.00\n' +
    '2024-12-26,Electricity,Electricity,61.00,EUR,30.50,-30.50\n' +
    ',Total balance,,,EUR,10.51,-10.51\n'],
  ['splitwise: German resave', 'WG Küche.csv',
    '﻿Date;Description;Category;Cost;Currency;Jonas;Mia\r\n' +
    '01.02.2025;Strom Februar;Electricity;84,20;EUR;42,10;-42,10\r\n' +
    '03.02.2025;Mia paid Jonas;Payment;42,10;EUR;-42,10;42,10\r\n'],
  ['splitwise: several people up', 'g.csv',
    'Date,Description,Category,Cost,Currency,A,B,C,D\n' +
    '2025-01-10,Party,Entertainment - Other,100.00,EUR,30.00,20.00,-25.00,-25.00\n' +
    '2025-01-11,Odd cents,General,10.01,EUR,2.00,2.00,-4.00,0.00\n'],

  // ---- Tricount / Sesterce ("Paid by X", "Paid for X")
  // the hotel: Pierre paid it all, Sophie and Brad owe; a third each of 100 (rounded shares
  // evened out); a refund (income) of 30 shared by all three; Brad pays Pierre back
  ['tricount: paid by / paid for', 'Ski trip.csv',
    'Date,Title,Paid by Pierre,Paid by Sophie,Paid by Brad,Paid for Pierre,Paid for Sophie,Paid for Brad,Currency,Category\n' +
    '20230722,Hotel aBis,358.0,0.0,0.0,0.0,169.0,189.0,EUR,Hosting\n' +
    '2023-07-23,Groceries,0,100,0,33.33,33.33,33.33,EUR,Food & Drink\n' +
    '2023-07-24,Refund ski pass,-30,0,0,-10,-10,-10,EUR,\n' +
    '2023-07-25,Brad paid Pierre,0,0,50,50,0,0,EUR,Transfer\n'],

  // ---- Settle Up ("Who paid", a column per person with their share; Chris never paid)
  ['settle up: who paid + shares', 'settleup.csv',
    'Who paid,Amount,Currency,Purpose,Date,Anna,Ben,Chris\n' +
    'Anna,60.00,EUR,Dinner,2025-06-01 19:30,20.00,20.00,20.00\n' +
    'Ben,45.00,EUR,Tickets,2025-06-02 10:00,,15.00,30.00\n' +
    'Anna,12.00,EUR,Taxi,2025-06-03 23:10,0,0,0\n'],

  // ---- Splid and plain spreadsheets ("Paid by", "For whom")
  ['splid-like list', 'Barcelona.csv',
    'Title,Amount,Currency,Date,Paid by,For whom\n' +
    'Tapas,45.00,EUR,2025-09-12,Lena,All\n' +
    'Museum,30.00,EUR,2025-09-13,Sam,"Lena, Sam"\n' +
    'Flamenco,25.00,EUR,2025-09-13,Omar,Omar & Lena\n' +
    'Lena paid Omar back,10.00,EUR,2025-09-14,Lena,Omar\n' +
    'Ice cream,-,EUR,2025-09-14,Sam,All\n' +
    'Total,100.00,,,,\n'],
  ['German spreadsheet, month first', 'WG.csv',
    'Datum;Beschreibung;Betrag;Bezahlt von;Für wen\n' +
    '10/02/2025;Strom;90,00;Jonas;Alle\n' +
    '10/13/2025;Putzmittel;12,50;Mia;Jonas und Mia\n'],
  // not recognised: which column is what? (then read with the columns picked)
  ['unknown columns', 'shared.csv', 'When,What,How much,Who,With\n2025-04-01,Pizza,30,Ana,Ana+Ben+Cem\n2025-04-02,Beer,12,Ben,Ana+Ben\n'],
  ['unknown columns, picked', 'shared.csv', 'When,What,How much,Who,With\n2025-04-01,Pizza,30,Ana,Ana+Ben+Cem\n2025-04-02,Beer,12,Ben,Ana+Ben\n',
    { currency: 'GBP', map: { date: 0, description: 1, amount: 2, payer: 3, forWhom: 4, currency: -1, category: -1 } satisfies ColumnMap }],
  ['shift timesheet', 'shifts.csv', 'Date,Employer,Start,End,Break (min)\n2026-09-01,Café Rot,09:00,17:00,30\n'],
  ['only a header', 'x.csv', 'Date,Description,Category,Cost,Currency,A,B\n'],
  ['nothing', 'x.csv', '  \n'],
]

// ---- a small Excel workbook, as Splid or Settle Up's Premium export might look: a summary
// sheet first, then the expenses with Excel day numbers and computed shares
function crc32(b: Uint8Array) {
  let c = ~0
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
function zip(files: [string, string][]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = []
  let off = 0
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8'), comp = deflateRawSync(raw), nm = Buffer.from(name)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8)
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42)
    parts.push(h, nm, comp); central.push(c, nm)
    off += 30 + nm.length + comp.length
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return new Uint8Array(Buffer.concat([...parts, cd, e]))
}
const S = ['Trip to Prague', 'Title', 'Amount', 'Currency', 'Date', 'Paid by', 'Anna', 'Ben', 'Chris', 'Hostel', 'EUR', 'Beer &amp; snacks', 'Summary']
const cellS = (r: string, i: number) => `<c r="${r}" t="s"><v>${i}</v></c>`
const cellN = (r: string, v: string) => `<c r="${r}"><v>${v}</v></c>`
const book = zip([
  ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Expenses" sheetId="2" r:id="rId2"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="/xl/worksheets/sheet2.xml"/></Relationships>'],
  ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${S.map((s) => s === 'Beer &amp; snacks' ? `<si><r><t>Beer </t></r><r><t xml:space="preserve">&amp; snacks</t></r></si>` : `<si><t>${s}</t></si>`).join('')}</sst>`],
  ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData><row r="1">${cellS('A1', 0)}</row><row r="2">${cellS('A2', 12)}${cellN('B2', '120')}</row></sheetData></worksheet>`],
  ['xl/worksheets/sheet2.xml', '<?xml version="1.0"?><worksheet><sheetData>' +
    `<row r="1">${cellS('A1', 0)}</row>` +
    `<row r="3">${[1, 2, 3, 4, 5, 6, 7, 8].map((s, i) => cellS(String.fromCharCode(65 + i) + '3', s)).join('')}</row>` +
    `<row r="4">${cellS('A4', 9)}${cellN('B4', '100')}${cellS('C4', 10)}${cellN('D4', '45748')}${cellS('E4', 6)}${cellN('F4', '33.333333333333336')}${cellN('G4', '33.333333333333336')}${cellN('H4', '33.333333333333336')}</row>` +
    `<row r="5">${cellS('A5', 11)}${cellN('B5', '20.399999999999999')}${cellS('C5', 10)}${cellN('D5', '45749')}${cellS('E5', 7)}<c r="F5" t="inlineStr"><is><t>10.2</t></is></c><c r="H5" t="str"><v>10.2</v></c></row>` +
    '</sheetData></worksheet>'],
])

const out = {
  cases: [
    ...csv.map(([name, file, text, opts]) => ({ name, kind: 'csv', file, text, opts: opts || {}, want: importCsv(text, { fileName: file, ...(opts || {}) }) })),
  ] as Record<string, unknown>[],
}
const sheets = await readXlsx(book)
out.cases.push({ name: 'excel workbook', kind: 'xlsx', file: 'Prague.xlsx', b64: Buffer.from(book).toString('base64'), opts: {}, sheets,
  want: importSheets(sheets, { fileName: 'Prague.xlsx' }) })
writeFileSync(new URL('./expense-import-vectors.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
for (const c of out.cases) console.log(c.name, '→', JSON.stringify(c.want))
console.log('sheets', JSON.stringify(sheets))
