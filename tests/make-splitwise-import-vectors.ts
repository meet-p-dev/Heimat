/* Writes tests/splitwise-import-vectors.json from the web importer (src/lib/importSplitwise.ts).
   Every answer here was read and checked by hand before it was kept; the iPhone importer
   (ios-native/Heimat/SplitwiseImport.swift) must give the same. Made-up people only. */
import { writeFileSync } from 'node:fs'
import { importSplitwise } from '../src/lib/importSplitwise.ts'

const cases: [string, string, string][] = [
  // Rent: Alex paid 600 and Priya 300, split three ways — Priya ends up square, so the file
  // can't show she paid; balances still come out exact. Pizza: 10,00 split three ways.
  ['flat in euros', 'sunny-wg_2025-05-03_export.csv',
    'Date,Description,Category,Cost,Currency,Alex Kim,Priya Nair,Tom Berg\n' +
    '2025-03-01,Rewe,Groceries,30.00,EUR,20.00,-10.00,-10.00\n' +
    '2025-03-02,Rent March,Rent,900.00,EUR,300.00,0.00,-300.00\n' +
    '2025-03-04,Priya N. paid Alex K.,Payment,10.00,EUR,-10.00,10.00,0.00\n' +
    '2025-03-05,Pizza,Dining out,10.00,EUR,6.67,-3.33,-3.34\n' +
    '2025-03-06,"Döner, Club Mate",General,12.00,EUR,0.00,0.00,0.00\n' +
    '\n' +
    ',Total balance, , ,EUR,316.67,-3.33,-313.34\n'],
  // two of them paid for the hotel; a yen ticket; the USD book has its own total row
  ['trip in three currencies', 'Lisbon trip_2025-08-20_export.csv',
    'Date,Description,Category,Cost,Currency,Priya,Sam,Lena\n' +
    '2025-08-01,Hotel,Hotel,300.00,EUR,100.00,100.00,-200.00\n' +
    '2025-08-02,Train tickets,Bus/train,3000.00,JPY,2000.00,-1000.00,-1000.00\n' +
    '2025-08-03,Uber,Taxi,25.50,USD,-12.75,12.75,0.00\n' +
    '2025-08-04,Lena paid Priya,Payment,50.00,EUR,-50.00,0.00,50.00\n' +
    '\n' +
    ',Total balance,,,EUR,50.00,100.00,-150.00\n' +
    ',Total balance,,,JPY,2000.00,-1000.00,-1000.00\n' +
    ',Total balance,,,USD,-12.75,12.75,0.00\n'],
  // a refund (negative cost), a row that doesn't add up, a bad date, and a total that is a cent off
  ['odd rows', 'export.csv',
    'Date,Description,Category,Cost,Currency,Me,You\n' +
    '2024-12-24,Gift return,Gifts,-40.00,EUR,-20.00,20.00\n' +
    '2024-12-25,Broken,General,10.00,EUR,5.00,-4.00\n' +
    '2024-13-01,Bad date,General,10.00,EUR,5.00,-5.00\n' +
    '2024-12-26,Electricity,Electricity,61.00,EUR,30.50,-30.50\n' +
    ',Total balance,,,EUR,10.51,-10.51\n'],
  // opened in Excel and saved again in German: semicolons, decimal commas, day first
  ['German resave', 'WG Küche.csv',
    '﻿Date;Description;Category;Cost;Currency;Jonas;Mia\r\n' +
    '01.02.2025;Strom Februar;Electricity;84,20;EUR;42,10;-42,10\r\n' +
    '03.02.2025;Mia paid Jonas;Payment;42,10;EUR;-42,10;42,10\r\n'],
  ['several people up', 'g.csv',
    'Date,Description,Category,Cost,Currency,A,B,C,D\n' +
    '2025-01-10,Party,Entertainment - Other,100.00,EUR,30.00,20.00,-25.00,-25.00\n' +
    '2025-01-11,Odd cents,General,10.01,EUR,2.00,2.00,-4.00,0.00\n'],
  ['shift timesheet', 'shifts.csv', 'Date,Employer,Start,End,Break (min)\n2026-09-01,Café Rot,09:00,17:00,30\n'],
  ['only a header', 'x.csv', 'Date,Description,Category,Cost,Currency,A,B\n'],
  ['nothing', 'x.csv', '  \n'],
]
const out = { cases: cases.map(([name, file, text]) => ({ name, file, text, want: importSplitwise(text, file) })) }
writeFileSync(new URL('./splitwise-import-vectors.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
for (const c of out.cases) console.log(c.name, '→', JSON.stringify(c.want))
