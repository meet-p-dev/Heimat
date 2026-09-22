import Foundation

// MARK: - Formatting

enum Fmt {
    static let de = Locale(identifier: "de_DE")
    private static var cal: Calendar { Calendar(identifier: .gregorian) }

    static func money(_ v: Double, _ code: String) -> String {
        v.formatted(.currency(code: code).locale(de).precision(.fractionLength(2)))
    }
    /// German comma decimals, as everywhere in Heimat
    static func num(_ v: Double, _ digits: Int = 1) -> String {
        v.formatted(.number.locale(de).precision(.fractionLength(digits)))
    }
    /// "12,50" or "12.50" → 12.5
    static func parse(_ s: String) -> Double {
        Double(s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")) ?? 0
    }
    static func input(_ v: Double) -> String { v == 0 ? "" : String(v).replacingOccurrences(of: ".", with: ",").replacingOccurrences(of: ",0$", with: "", options: .regularExpression) }

    static func ymd(_ d: Date) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    static func today() -> String { ymd(Date()) }
    static func date(_ s: String) -> Date? {
        let p = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    /// "Today", "Yesterday", "Tuesday", "3 Sep", "3 Sep 2025"
    static func relDay(_ s: String) -> String {
        guard let d = date(s), let t = date(today()) else { return s }
        let diff = cal.dateComponents([.day], from: d, to: t).day ?? 0
        if diff == 0 { return "Today" }
        if diff == 1 { return "Yesterday" }
        if diff > 1 && diff < 7 { return d.formatted(.dateTime.weekday(.wide)) }
        let sameYear = cal.component(.year, from: d) == cal.component(.year, from: Date())
        return sameYear ? d.formatted(.dateTime.day().month(.abbreviated)) : d.formatted(.dateTime.day().month(.abbreviated).year())
    }
    static func monthLabel(_ s: String) -> String {
        guard let d = date(String(s.prefix(7)) + "-01") else { return s }
        return d.formatted(.dateTime.month(.wide).year())
    }
    /// "Monday, 22 September" — the kicker above every title but Home's.
    static func longToday() -> String {
        Date().formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
    static func greeting() -> String {
        let h = cal.component(.hour, from: Date())
        return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
    }
    static func initials(_ name: String) -> String {
        let p = name.split(separator: " ")
        let s = (p.first?.first.map(String.init) ?? "?") + (p.count > 1 ? String(p.last!.first!) : "")
        return s.uppercased()
    }
}

// MARK: - Money maths, ported one-to-one from src/lib/derive.ts

enum Calc {
    static func balances(members: [Member], expenses: [Expense], settles: [Settlement]) -> [String: Double] {
        var net: [String: Double] = [:]
        members.forEach { net[$0.userId] = 0 }
        for e in expenses where net[e.paidBy] != nil {
            net[e.paidBy]! += e.amount
            for u in e.parts where net[u] != nil { net[u]! -= e.share }
        }
        for s in settles {
            if net[s.fromUser] != nil { net[s.fromUser]! += s.amount }
            if net[s.toUser] != nil { net[s.toUser]! -= s.amount }
        }
        return net
    }

    struct Suggestion: Hashable { let from: String, to: String, amount: Double }

    /// greedy debt simplification: largest debtor pays largest creditor until everyone is within ±0,50
    static func suggestions(_ b: [String: Double]) -> [Suggestion] {
        var debtors = b.filter { $0.value < -0.5 }.map { ($0.key, -$0.value) }.sorted { $0.1 > $1.1 }
        var creditors = b.filter { $0.value > 0.5 }.map { ($0.key, $0.value) }.sorted { $0.1 > $1.1 }
        var out: [Suggestion] = []
        var i = 0, j = 0
        while i < debtors.count && j < creditors.count {
            let pay = min(debtors[i].1, creditors[j].1)
            if pay > 0.5 { out.append(Suggestion(from: debtors[i].0, to: creditors[j].0, amount: pay)) }
            debtors[i].1 -= pay; creditors[j].1 -= pay
            if debtors[i].1 <= 0.5 { i += 1 }
            if creditors[j].1 <= 0.5 { j += 1 }
        }
        return out
    }

    static func myShare(_ expenses: [Expense], uid: String?) -> Double {
        guard let uid else { return 0 }
        return expenses.reduce(0) { $0 + ($1.parts.contains(uid) ? $1.share : 0) }
    }

    static func minutes(_ t: String) -> Int {
        let p = t.split(separator: ":").compactMap { Int($0) }
        return p.count >= 2 ? p[0] * 60 + p[1] : 0
    }

    /// `legalHours` is what counts against the weekly limit; `paidHours` is
    /// what you are paid for, which differs when a break is paid.
    struct ShiftCalc { let paidHours, legalHours, pay: Double; let overnight: Bool }

    /// handles overnight shifts, paid breaks and rows that only have hours
    static func shift(_ s: Shift) -> ShiftCalc {
        if !s.start.isEmpty && !s.end.isEmpty {
            let gross = Double((minutes(s.end) - minutes(s.start) + 1440) % 1440)
            let worked = max(0, gross - s.breakMin)
            let paidH = (s.paidBreak ? gross : worked) / 60
            return ShiftCalc(paidHours: paidH, legalHours: worked / 60, pay: s.pay ?? paidH * s.wage, overnight: minutes(s.end) <= minutes(s.start))
        }
        let h = s.hours ?? 0
        return ShiftCalc(paidHours: h, legalHours: h, pay: s.pay ?? h * s.wage, overnight: false)
    }

    struct EmployerStat: Identifiable { let name: String; var pay, hours: Double; var id: String { name } }
    struct WorkStats {
        var daysUsed = 0.0, weekH = 0.0, earnMonth = 0.0, earnYear = 0.0, earnAll = 0.0, avgRate = 0.0
        var budget = 120, weekCap = 20
        var byEmployer: [EmployerStat] = []
        enum Tone { case safe, close, over }
        var tone: Tone = .safe
    }

    static func work(_ shifts: [Shift], weekCap: Int, yearDays: Int) -> WorkStats {
        var w = WorkStats(); w.budget = max(yearDays, 1); w.weekCap = max(weekCap, 1)
        let today = Fmt.today(), yr = String(today.prefix(4)), mo = String(today.prefix(7))
        var cal = Calendar(identifier: .gregorian); cal.firstWeekday = 2
        let monday = Fmt.ymd(cal.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date())
        var full = 0.0, half = 0.0, yearPaidH = 0.0
        var emp: [String: EmployerStat] = [:]
        for s in shifts {
            let d = shift(s)
            w.earnAll += d.pay
            if s.date.hasPrefix(yr) {
                w.earnYear += d.pay
                if s.wage > 0 { yearPaidH += d.paidHours }
                if d.legalHours > 0 { if d.legalHours >= 4 { full += 1 } else { half += 1 } }
            }
            if s.date.hasPrefix(mo) {
                w.earnMonth += d.pay
                let k = s.employer.isEmpty ? "Unassigned" : s.employer
                emp[k, default: EmployerStat(name: k, pay: 0, hours: 0)].pay += d.pay
                emp[k]!.hours += d.paidHours
            }
            if s.date >= monday { w.weekH += d.legalHours }
        }
        w.daysUsed = full + half * 0.5
        w.avgRate = yearPaidH > 0 ? w.earnYear / yearPaidH : 0
        w.byEmployer = emp.values.sorted { $0.pay > $1.pay }
        let dayPct = w.daysUsed / Double(w.budget), weekPct = w.weekH / Double(w.weekCap)
        w.tone = dayPct >= 1 || weekPct >= 1 ? .over : dayPct >= 0.8 || weekPct >= 0.8 ? .close : .safe
        return w
    }
}

// MARK: - Exchange rate (keyless open.er-api.com)

enum Rates {
    static func fetch(host: String, home: String) async -> Double? {
        guard host != home, let url = URL(string: "https://open.er-api.com/v6/latest/\(host)") else { return nil }
        struct R: Decodable { let rates: [String: Double]? }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let v = (try? JSONDecoder().decode(R.self, from: data))?.rates?[home] else { return nil }
        return (v * 100).rounded() / 100
    }
}
