import Foundation

/// Bringing shifts in: Splitlife's own "Export my data" (JSON) or "Export shifts" (CSV), or a
/// timesheet from a spreadsheet — comma, semicolon or tab, English or German headings,
/// 2026-10-02 or 02.10.2026, 12,50 or 12.50. Shifts already on this phone are left alone
/// (same id, or same day, employer and times), so importing twice adds nothing.
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
    private static func groups(_ pattern: String, _ s: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
    }
    static func normDate(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if let g = groups("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$", t) { return validDate(Int(g[1])!, Int(g[2])!, Int(g[3])!) }
        // day first, as in Germany
        if let g = groups("^([0-9]{1,2})[./]([0-9]{1,2})[./]([0-9]{4})$", t) { return validDate(Int(g[3])!, Int(g[2])!, Int(g[1])!) }
        return nil
    }
    /// "9:00", "09:00", "9.00", "9" → "09:00"; "" stays ""; anything else is nil
    static func normTime(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return "" }
        guard let g = groups("^([0-9]{1,2})(?:[:.]([0-9]{2}))?$", t) else { return nil }
        let h = Int(g[1])!, mi = Int(g[2]) ?? 0
        if h > 24 || mi > 59 || (h == 24 && mi > 0) { return nil }
        return (g[1].count == 1 ? "0" + g[1] : g[1]) + ":" + (g[2].isEmpty ? "00" : g[2])
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
        ("date", "^(date|datum|day|tag)$"),
        ("employer", "^(employer|arbeitgeber|job|company|firma)$"),
        ("start", "^(start|beginn|begin|from|von)$"),
        ("end", "^(end|ende|to|bis)$"),
        ("breakMin", "^(break( \\(min\\))?|pause( \\(min\\))?|break minutes)$"),
        ("paidBreak", "^(paid break|bezahlte pause)$"),
        ("hours", "^(paid hours|hours|stunden|arbeitsstunden)$"),
        ("wage", "^(hourly wage|wage|rate|stundenlohn|lohn)$"),
        ("pay", "^(gross pay|pay|brutto|verdienst)$"),
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
        if !cols.contains("date") { return Array(repeating: nil, count: Swift.max(1, all.count - 1)) }
        func at(_ r: [String], _ k: String) -> String { guard let i = cols.firstIndex(of: k) else { return "" }; return i < r.count ? r[i] : "" }
        return all.dropFirst().map { r in
            guard let date = normDate(at(r, "date")), let start = normTime(at(r, "start")), let end = normTime(at(r, "end")),
                  let breakMin = normNum(at(r, "breakMin")), let wage = normNum(at(r, "wage")), let hours = normNum(at(r, "hours")) else { return nil }
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

    static func run(_ text: String, have: [Have]) -> Result {
        var t = text
        if t.unicodeScalars.first == "\u{FEFF}" { t.unicodeScalars.removeFirst() }
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        let rows: [Row?]
        if t.hasPrefix("{") || t.hasPrefix("[") {
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
