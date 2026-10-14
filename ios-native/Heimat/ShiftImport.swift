import Foundation

/// Bringing shifts in: Splitlife's own "Export my data" (JSON) or "Export shifts" (CSV), a
/// timesheet from a spreadsheet or a time tracker (Clockify, Toggl, Harvest…), or a calendar
/// file (.ics) from a rostering app (Planday, Deputy, When I Work, Shiftbase…). Shifts already on
/// this phone are left alone (same id, or same day, employer and times), so importing twice adds
/// nothing. A file that says no hourly wage gives shifts with wage 0; the app asks for each job's
/// wage before adding them.
/// The same as src/lib/importShifts.ts, held to tests/shift-import-vectors.json.
enum ShiftImport {
    struct Row: Equatable {
        var id: String?
        var date: String, employer: String, start: String, end: String
        var breakMin: Int, paidBreak: Bool, wage: Double, hours: Double?
        /// what it paid, when the file says (older shifts may have pay but no hourly wage)
        var pay: Double?
    }
    struct Have { var id: String?; var date: String; var employer: String; var start: String; var end: String; var hours: Double? }
    struct Result { var shifts: [Row]; var skipped: Int; var bad: Int }

    static let max = 5000

    private static func validDate(_ y: Int, _ m: Int, _ d: Int) -> String? {
        guard (2000...2100).contains(y), (1...12).contains(m), d >= 1 else { return nil }
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
        guard d <= days else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }
    private static func groups(_ pattern: String, _ s: String, _ opts: NSRegularExpression.Options = []) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: opts),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
    }
    /// "2026-10-02", "2026/10/02", "02.10.2026", "02/10/2026" (day first, as in Germany, unless the
    /// file writes the month first)
    static func normDate(_ s: String, monthFirst: Bool = false) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if let g = groups("^([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})$", t) { return validDate(Int(g[1])!, Int(g[2])!, Int(g[3])!) }
        if let g = groups("^([0-9]{1,2})[./]([0-9]{1,2})[./]([0-9]{4})$", t) {
            return monthFirst ? validDate(Int(g[3])!, Int(g[1])!, Int(g[2])!) : validDate(Int(g[3])!, Int(g[2])!, Int(g[1])!)
        }
        return nil
    }
    /// does the file write the month first? when some date can't be day-first — or, with no date
    /// saying either way, when its times are written the American way ("5:30 PM")
    private static func monthFirstIn(_ cells: [String], american: Bool) -> Bool {
        var dayFirst = false, monthFirst = false
        for c in cells {
            guard let g = groups("^([0-9]{1,2})[./]([0-9]{1,2})[./][0-9]{4}", c.trimmingCharacters(in: .whitespacesAndNewlines)) else { continue }
            if Int(g[1])! > 12 { dayFirst = true }
            if Int(g[2])! > 12 { monthFirst = true }
        }
        return !dayFirst && (monthFirst || american)
    }
    /// "9:00", "09:00", "9.00", "9", "09:00:00", "9:00 PM" → "09:00" / "21:00"; "" stays ""; anything else is nil
    static func normTime(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return "" }
        guard let g = groups("^([0-9]{1,2})(?:[:.]([0-9]{2}))?(?::[0-9]{2})?\\s*([ap])?\\.?(?:m\\.?)?$", t, .caseInsensitive) else { return nil }
        var h = Int(g[1])!
        let mi = Int(g[2]) ?? 0
        if !g[3].isEmpty {
            if h < 1 || h > 12 { return nil }
            h = h % 12 + (g[3].lowercased() == "p" ? 12 : 0)
        }
        if h > 24 || mi > 59 || (h == 24 && mi > 0) { return nil }
        return String(format: "%02d:%02d", h, mi)
    }
    /// a cell holding a date and a time ("2026-10-02 09:00:00", "02.10.2026 9:00", "10/02/2026 9:00 AM")
    private static func dateTime(_ s: String) -> (date: String, time: String)? {
        guard let g = groups("^(\\S+)[ T]([0-9]{1,2}[:.][0-9]{2}.*)$", s.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return (g[1], g[2])
    }
    /// hours as 7.5, "7,5", "7:30" or "07:30:00" → 7.5 (to the minute); "" → 0; junk → nil
    static func normHours(_ s: String) -> Double? {
        if let g = groups("^([0-9]+):([0-9]{2})(?::([0-9]{2}))?$", s.trimmingCharacters(in: .whitespacesAndNewlines)) {
            let x = Double(g[1])! + Double(g[2])! / 60 + (Double(g[3]) ?? 0) / 3600
            return (x * 100).rounded() / 100
        }
        return normNum(s)
    }
    /// "12,50", "12.50", "1.234,50", "1,234.50", "€ 12" → number; "" → 0; junk → nil
    static func normNum(_ s: String) -> Double? {
        var t = String(s.unicodeScalars.filter { $0 != "€" && !CharacterSet.whitespacesAndNewlines.contains($0) })
        if t.isEmpty { return 0 }
        let c = t.lastIndex(of: ","), d = t.lastIndex(of: ".")
        let commaLast: Bool = { guard let c else { return false }; guard let d else { return true }; return c > d }()
        if commaLast {
            t = t.replacingOccurrences(of: ".", with: "")
            if let i = t.firstIndex(of: ",") { t.replaceSubrange(i...i, with: ".") }
        } else {
            t = t.replacingOccurrences(of: ",", with: "")
        }
        guard groups("^-?[0-9]+(\\.[0-9]+)?$", t) != nil, let n = Double(t), n.isFinite, n >= 0 else { return nil }
        return n
    }
    private static func yes(_ s: String) -> Bool {
        ["yes", "y", "true", "1", "ja", "j", "x"].contains(s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    private static func splitCsv(_ text: String, _ sep: Unicode.Scalar) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], cell = String.UnicodeScalarView(), q = false
        let u = Array(text.unicodeScalars)
        var i = 0
        while i < u.count {
            let ch = u[i]
            if q {
                if ch == "\"" { if i + 1 < u.count && u[i + 1] == "\"" { cell.append("\""); i += 1 } else { q = false } }
                else { cell.append(ch) }
            } else if ch == "\"" { q = true }
            else if ch == sep { row.append(String(cell)); cell = .init() }
            else if ch == "\n" || ch == "\r" {
                if ch == "\r" && i + 1 < u.count && u[i + 1] == "\n" { i += 1 }
                row.append(String(cell)); rows.append(row); row = []; cell = .init()
            } else { cell.append(ch) }
            i += 1
        }
        if !cell.isEmpty || !row.isEmpty { row.append(String(cell)); rows.append(row) }
        return rows.filter { $0.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    }

    private static let heads: [(String, String)] = [
        ("date", "^(date|datum|day|tag|start date|startdatum|work date|shift date)$"),
        ("employer", "^(employer|arbeitgeber|job|company|firma|project|projekt|client|kunde|workplace|arbeitsort|location|position)$"),
        ("start", "^(start|beginn|begin|from|von|start time|startzeit|clock in|clock-in|check in|check-in|time in|in|arbeitsbeginn|shift start)$"),
        ("end", "^(end|ende|to|bis|end time|endzeit|clock out|clock-out|check out|check-out|time out|out|arbeitsende|shift end)$"),
        ("breakMin", "^(break( \\(min\\))?|pause( \\(min\\))?|break minutes|break \\(minutes\\)|pause \\(minuten\\))$"),
        ("breakHours", "^(break hours|pausenstunden|break \\(h\\))$"),
        ("paidBreak", "^(paid break|bezahlte pause)$"),
        ("hours", "^(paid hours|hours|stunden|arbeitsstunden|duration|dauer|duration \\(h\\)|duration \\(decimal\\)|hours worked|worked hours|total hours|time \\(h\\)|time \\(decimal\\))$"),
        ("wage", "^(hourly wage|wage|rate|hourly rate|pay rate|stundenlohn|lohn|stundensatz|billable rate( \\([^)]*\\))?)$"),
        ("pay", "^(gross pay|pay|brutto|verdienst|earnings|billable amount( \\([^)]*\\))?)$"),
    ]

    private static func fromCsv(_ text: String) -> [Row?] {
        var first = String(text.unicodeScalars.prefix { $0 != "\n" })
        if first.hasSuffix("\r") { first.removeLast() }
        func count(_ c: Unicode.Scalar) -> Int { first.unicodeScalars.filter { $0 == c }.count }
        let sep = (([";", "\t", ","] as [Unicode.Scalar]).reduce(",") { a, b in count(b) > count(a) ? b : a })
        let all = splitCsv(text, sep)
        if all.isEmpty { return [] }
        let cols = all[0].map { h in
            let k = h.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return heads.first { groups($0.1, k) != nil }?.0 ?? "skip"
        }
        if !cols.contains("date") && !cols.contains("start") { return Array(repeating: nil, count: Swift.max(1, all.count - 1)) }
        // the first column of that kind with something in it (Toggl's "Client" is often empty, its "Project" not)
        func at(_ r: [String], _ k: String) -> String {
            var first = -1
            for (i, c) in cols.enumerated() where c == k {
                if first < 0 { first = i }
                if i < r.count, !r[i].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return r[i] }
            }
            return first >= 0 && first < r.count ? r[first] : ""
        }
        // a date column, or the date in a "Clock in" cell that holds a date and a time
        func dayOf(_ r: [String]) -> String {
            if let d = dateTime(at(r, "date"))?.date { return d }
            if !at(r, "date").isEmpty { return at(r, "date") }
            return dateTime(at(r, "start"))?.date ?? ""
        }
        let ampm = "[0-9]\\s*[ap]\\.?m\\.?$"
        let american = all.dropFirst().contains { groups(ampm, at($0, "start").trimmingCharacters(in: .whitespacesAndNewlines), .caseInsensitive) != nil
            || groups(ampm, at($0, "end").trimmingCharacters(in: .whitespacesAndNewlines), .caseInsensitive) != nil }
        let mf = monthFirstIn(all.dropFirst().map(dayOf), american: american)
        return all.dropFirst().map { r in
            let sdt = dateTime(at(r, "start")), edt = dateTime(at(r, "end"))
            let bh: Double? = at(r, "breakMin").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? normHours(at(r, "breakHours")) : nil
            guard let date = normDate(dayOf(r), monthFirst: mf), let start = normTime(sdt?.time ?? at(r, "start")), let end = normTime(edt?.time ?? at(r, "end")),
                  let breakMin = bh.map({ $0 * 60 }) ?? normNum(at(r, "breakMin")), let wage = normNum(at(r, "wage")), let hours = normHours(at(r, "hours")) else { return nil }
            let payText = at(r, "pay").trimmingCharacters(in: .whitespacesAndNewlines)
            let pay = payText.isEmpty ? nil : normNum(payText)
            if !payText.isEmpty && pay == nil { return nil }
            let timed = !start.isEmpty && !end.isEmpty
            if !timed && !(hours > 0) { return nil }
            return Row(id: nil, date: date, employer: at(r, "employer").trimmingCharacters(in: .whitespacesAndNewlines),
                       start: timed ? start : "", end: timed ? end : "", breakMin: Int(breakMin.rounded()),
                       paidBreak: yes(at(r, "paidBreak")), wage: wage, hours: timed ? nil : hours, pay: pay)
        }
    }

    private static func isBool(_ v: Any) -> Bool { (v as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false }

    private static func fromJson(_ v: Any) -> [Row?] {
        let list: [Any]? = (v as? [Any]) ?? ((v as? [String: Any])?["shifts"] as? [Any])
        guard let list else { return [nil] }
        return list.map { x in
            guard let o = x as? [String: Any] else { return nil }
            func str(_ k: String) -> String { o[k] as? String ?? "" }
            func num(_ k: String) -> Double? {
                guard let v = o[k], !(v is NSNull) else { return 0 }
                if let s = v as? String { return normNum(s) }
                if !isBool(v), let n = v as? NSNumber, n.doubleValue.isFinite, n.doubleValue >= 0 { return n.doubleValue }
                return nil
            }
            guard let date = normDate(str("date")), let start = normTime(str("start")), let end = normTime(str("end")),
                  let breakMin = num("breakMin"), let wage = num("wage"), let hours = num("hours") else { return nil }
            let hasPay = o["pay"] != nil && !(o["pay"] is NSNull)
            let pay = hasPay ? num("pay") : nil
            if hasPay && pay == nil { return nil }
            let timed = !start.isEmpty && !end.isEmpty
            if !timed && !(hours > 0) { return nil }
            let paid = (o["paidBreak"].map { isBool($0) && ($0 as! NSNumber).boolValue } ?? false) || ((o["paidBreak"] as? String).map(yes) ?? false)
            return Row(id: str("id").isEmpty ? nil : str("id"), date: date, employer: str("employer").trimmingCharacters(in: .whitespacesAndNewlines),
                       start: timed ? start : "", end: timed ? end : "", breakMin: Int(breakMin.rounded()), paidBreak: paid,
                       wage: wage, hours: timed ? nil : hours, pay: pay)
        }
    }

    /// how JavaScript writes a number, so the duplicate key reads the same in both apps
    private static func js(_ d: Double?) -> String {
        guard let d else { return "" }
        return d == d.rounded() && abs(d) < 1e15 ? String(Int(d)) : String(d)
    }
    private static func key(date: String, employer: String, start: String, end: String, hours: Double?) -> String {
        [date, employer.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), start, end,
         !start.isEmpty && !end.isEmpty ? "" : js(hours)].joined(separator: "|")
    }

    // MARK: calendar files

    /// an event's time as the clock on the wall shows it: UTC ("…Z") in `tz`, anything else as written
    private static func wall(_ v: String, _ tz: TimeZone) -> (date: String, time: String, ms: Double)? {
        guard let g = groups("^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})(Z?)$", v.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        var (y, mo, d, h, mi) = (Int(g[1])!, Int(g[2])!, Int(g[3])!, Int(g[4])!, Int(g[5])!)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        if !g[7].isEmpty, let at = utc.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi)) {
            var local = Calendar(identifier: .gregorian)
            local.timeZone = tz
            let c = local.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            (y, mo, d, h, mi) = (c.year!, c.month!, c.day!, c.hour!, c.minute!)
        }
        guard let date = validDate(y, mo, d), h <= 23, mi <= 59,
              let ms = utc.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))?.timeIntervalSince1970 else { return nil }
        return (date, String(format: "%02d:%02d", h, mi), ms * 1000)
    }
    private static func icsText(_ s: String) -> String {
        s.replacingOccurrences(of: "\\\\n", with: " ", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: "\\\\([,;\\\\])", with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    /// every timed event a shift on the day it starts, its title the job; all-day events aren't
    /// shifts, cancelled ones are left out (the same as importShifts.ts)
    private static func fromIcs(_ text: String, _ tz: TimeZone) -> [Row?] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\n[ \t]", with: "", options: .regularExpression).components(separatedBy: "\n")
        var rows: [Row?] = []
        var ev: [String: String]?
        for line in lines {
            let l = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if l.uppercased() == "BEGIN:VEVENT" { ev = [:]; continue }
            if l.uppercased() == "END:VEVENT" {
                if let e = ev, (e["STATUS"] ?? "").uppercased() != "CANCELLED" {
                    let s = e["DTSTART"].flatMap { wall($0, tz) }
                    var end = e["DTEND"].flatMap { wall($0, tz) }
                    if let s, end == nil, let dv = e["DURATION"], !dv.isEmpty,
                       let dur = groups("^PT?(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?$", dv, .caseInsensitive) {
                        let mins = ((Double(dur[1]) ?? 0) * 24 + (Double(dur[2]) ?? 0)) * 60 + (Double(dur[3]) ?? 0)
                        var utc = Calendar(identifier: .gregorian)
                        utc.timeZone = TimeZone(identifier: "UTC")!
                        let c = utc.dateComponents([.year, .month, .day, .hour, .minute], from: Date(timeIntervalSince1970: (s.ms + mins * 60000) / 1000))
                        end = wall(String(format: "%04d%02d%02dT%02d%02d00", c.year!, c.month!, c.day!, c.hour!, c.minute!), tz)
                    }
                    if let s, let end, case let minutes = (end.ms - s.ms) / 60000, minutes > 0, minutes <= 24 * 60 {
                        rows.append(Row(id: nil, date: s.date, employer: icsText(e["SUMMARY"] ?? ""), start: s.time, end: end.time,
                                        breakMin: 0, paidBreak: false, wage: 0, hours: nil, pay: nil))
                    } else { rows.append(nil) }
                }
                ev = nil
                continue
            }
            guard ev != nil, let g = groups("^([A-Za-z-]+)((?:;[^:]*)?):(.*)$", l) else { continue }
            let k = g[1].uppercased()
            if ev![k] == nil { ev![k] = g[3] }
        }
        return rows.isEmpty ? [nil] : rows
    }

    static func run(_ text: String, have: [Have], tz: TimeZone = .current) -> Result {
        var t = text
        if t.unicodeScalars.first == "\u{FEFF}" { t.unicodeScalars.removeFirst() }
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        let rows: [Row?]
        if t.uppercased().hasPrefix("BEGIN:VCALENDAR") { rows = fromIcs(t, tz) }
        else if t.hasPrefix("{") || t.hasPrefix("[") {
            if let v = try? JSONSerialization.jsonObject(with: Data(t.utf8), options: [.fragmentsAllowed]) { rows = fromJson(v) } else { rows = [nil] }
        } else { rows = fromCsv(t) }
        var ids = Set(have.compactMap(\.id))
        var keys = Set(have.map { key(date: $0.date, employer: $0.employer, start: $0.start, end: $0.end, hours: $0.hours) })
        var out: [Row] = [], skipped = 0, bad = 0
        for r in rows {
            guard let r else { bad += 1; continue }
            let k = key(date: r.date, employer: r.employer, start: r.start, end: r.end, hours: r.hours)
            if (r.id.map { ids.contains($0) } ?? false) || keys.contains(k) { skipped += 1; continue }
            if out.count >= max { bad += 1; continue }
            if let id = r.id { ids.insert(id) }
            keys.insert(k)
            out.append(r)
        }
        return Result(shifts: out, skipped: skipped, bad: bad)
    }
}

/// "2 already here, 1 couldn't be read"
enum ShiftImportNote {
    static func text(_ r: ShiftImport.Result) -> String {
        [r.skipped > 0 ? "\(r.skipped) already here" : nil, r.bad > 0 ? "\(r.bad) couldn't be read" : nil].compactMap { $0 }.joined(separator: ", ")
    }
}
