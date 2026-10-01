import SwiftUI

/// The six ways a bill can be divided — Splitwise's, worked out by
/// Ledger.computeShares (docs/money-engine.md, "Splitting one expense").
enum SplitMode: String, CaseIterable, Identifiable {
    case equal, exact, percent, shares, adjust, itemized
    var id: String { rawValue }

    /// what the segmented control says — six have to fit across a phone
    var short: String {
        switch self {
        case .equal: "Equal"
        case .exact: "Exact"
        case .percent: "%"
        case .shares: "Shares"
        case .adjust: "±"
        case .itemized: "Items"
        }
    }
    /// how the expense reads afterwards: "Split by percentage"
    var title: String {
        switch self {
        case .equal: "equally"
        case .exact: "by exact amounts"
        case .percent: "by percentage"
        case .shares: "by shares"
        case .adjust: "by adjustment"
        case .itemized: "by item"
        }
    }
    var hint: String {
        switch self {
        case .equal: "Everyone ticked pays the same."
        case .exact: "Type what each person owes. It has to add up to the total."
        case .percent: "Give each person a percentage. Together they make 100 %."
        case .shares: "Give each person a number of shares — 2 for a couple, 1 for everyone else."
        case .adjust: "Add or take off an amount for someone (say, +5 for their extra drink). The rest is split equally."
        case .itemized: "Add the receipt's lines and tick who had each. Tax, tip and discount are shared in proportion."
        }
    }
}

/// What the expense form is editing about who owes and who paid, as the text
/// the person typed — read into whole minor units only when it is needed, so a
/// half-typed "12," is never rounded behind their back.
struct SplitState: Equatable {
    struct Line: Identifiable, Equatable {
        var id = UUID()
        var label = ""
        var amount = ""
        var among: Set<String> = []
    }

    var mode: SplitMode = .equal
    /// who is in it, for an equal split and an adjusted one
    var among: Set<String> = []
    // each mode keeps its own figures, so trying another one and coming back loses nothing
    var exact: [String: String] = [:]
    var percent: [String: String] = [:]
    var shares: [String: String] = [:]
    var adjust: [String: String] = [:]
    var lines: [Line] = []
    var tax = "", tip = "", discount = ""
    /// several people paid, each the amount in `paid`
    var severalPaid = false
    var paid: [String: String] = [:]

    /// what was typed, in minor units: nothing typed is 0, nil is "that isn't an amount"
    static func read(_ s: String, _ cur: String) -> Int? {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? 0 : Money.parse(t, cur)
    }

    struct Built {
        var spec: Ledger.SplitSpec
        /// the first field that isn't a number: a person's id, or "tax" / "tip" / "discount" / "item"
        var unreadable: String?
    }

    /// the split as Ledger reads it
    func build(_ cur: String) -> Built {
        var unreadable: String?
        func values(_ texts: [String: String], _ who: [String], as cur: String) -> [String: Double] {
            var out: [String: Double] = [:]
            for u in who {
                guard let t = texts[u], !t.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
                guard let v = Self.read(t, cur) else { unreadable = unreadable ?? u; continue }
                out[u] = Double(v)
            }
            return out
        }
        switch mode {
        case .equal:
            return Built(spec: .init(type: "equal", among: Array(among)))
        case .exact:
            return Built(spec: .init(type: "exact", values: values(exact, Array(exact.keys), as: cur)), unreadable: unreadable)
        case .percent:
            // hundredths of a percent are basis points: "33,34" → 3334
            return Built(spec: .init(type: "percent", values: values(percent, Array(percent.keys), as: "EUR")), unreadable: unreadable)
        case .shares:
            // "1,5" → 150 hundredths → the weight 1.5, as the database stores it
            let w = values(shares, Array(shares.keys), as: "EUR").mapValues { $0 / 100 }
            return Built(spec: .init(type: "shares", values: w), unreadable: unreadable)
        case .adjust:
            return Built(spec: .init(type: "adjust", among: Array(among), values: values(adjust, Array(among), as: cur)), unreadable: unreadable)
        case .itemized:
            var items: [SplitData.Item] = []
            for l in lines {
                guard let v = Self.read(l.amount, cur) else { unreadable = unreadable ?? "item"; continue }
                items.append(.init(label: l.label.trimmingCharacters(in: .whitespaces).isEmpty ? nil : l.label.trimmingCharacters(in: .whitespaces),
                                   minor: Double(v), among: l.among.sorted(by: Ledger.less)))
            }
            func extra(_ s: String, _ key: String) -> Double? {
                guard let v = Self.read(s, cur) else { unreadable = unreadable ?? key; return nil }
                return v == 0 ? nil : Double(v)
            }
            let t = extra(tax, "tax"), p = extra(tip, "tip"), d = extra(discount, "discount")
            return Built(spec: .init(type: "itemized", items: items, tax: t, tip: p, discount: d), unreadable: unreadable)
        }
    }

    /// `expenses.split` for this split — nothing for an equal one, which split_among says all of
    func data(_ spec: Ledger.SplitSpec) -> SplitData? {
        switch mode {
        case .equal: nil
        case .itemized: SplitData(items: spec.items, tax: spec.tax, tip: spec.tip, discount: spec.discount)
        default: SplitData(values: spec.values)
        }
    }

    /// minor units each person paid when several did; nil entries mean one of them isn't an amount
    func payers(_ cur: String) -> [String: Int]? {
        var out: [String: Int] = [:]
        for (u, t) in paid where !t.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let v = Self.read(t, cur) else { return nil }
            if v != 0 { out[u] = v }
        }
        return out
    }

    /// Switching to a mode for the first time starts it where the equal split
    /// stood, so the figures already add up and only the differences need typing.
    mutating func start(_ m: SplitMode, total: Int, cur: String, seed: String) {
        let who = among.sorted(by: Ledger.less)
        guard !who.isEmpty else { return }
        switch m {
        case .exact where exact.values.allSatisfy(\.isEmpty) && total > 0:
            exact = Ledger.allocate(total, who, seed: seed).mapValues { Money.input($0, cur) }
        case .percent where percent.values.allSatisfy(\.isEmpty):
            percent = Ledger.allocate(10_000, who, seed: seed).mapValues { Money.input($0, "EUR") }
        case .shares where shares.values.allSatisfy(\.isEmpty):
            shares = Dictionary(uniqueKeysWithValues: who.map { ($0, "1") })
        case .itemized where lines.isEmpty:
            lines = [Line(among: among)]
        default: break
        }
    }

    /// the state an existing expense was saved in
    static func from(_ e: Expense) -> SplitState {
        var s = SplitState()
        let cur = e.currency
        s.mode = SplitMode(rawValue: e.splitType ?? "equal") ?? .equal
        s.among = Set(e.parts)
        let vals = e.split?.values ?? [:]
        let int = { (v: Double) in Int(v.rounded()) }
        switch s.mode {
        case .exact: s.exact = vals.mapValues { Money.input(int($0), cur) }
        case .percent: s.percent = vals.mapValues { Money.input(int($0), "EUR") }
        case .shares: s.shares = vals.mapValues { Money.input(int($0 * 100), "EUR").replacingOccurrences(of: ",00", with: "") }
        case .adjust: s.adjust = vals.filter { $0.value != 0 }.mapValues { Money.input(int($0), cur) }
        case .itemized:
            s.lines = (e.split?.items ?? []).map { Line(label: $0.label ?? "", amount: Money.input(int($0.minor), cur), among: Set($0.among)) }
            s.tax = e.split?.tax.map { Money.input(int($0), cur) } ?? ""
            s.tip = e.split?.tip.map { Money.input(int($0), cur) } ?? ""
            s.discount = e.split?.discount.map { Money.input(int($0), cur) } ?? ""
        case .equal: break
        }
        if let p = e.payers, p.count > 1 {
            s.severalPaid = true
            s.paid = p.mapValues { Money.input(int($0), cur) }
        }
        return s
    }
}

/// The "Split" part of the expense form: how, between whom, and whether it adds up.
struct SplitEditor: View {
    @Binding var s: SplitState
    let people: [Member]
    let total: Int
    let cur: String
    let seed: String
    let result: Ledger.SplitResult
    let unreadable: String?
    let name: (String) -> String
    let setTotal: (Int) -> Void

    private var shares: [String: Int] { if case .ok(let m) = result { m } else { [:] } }
    private func money(_ minor: Int) -> String { Fmt.money(Money.toMajor(minor, cur), cur) }

    var body: some View {
        Section {
            Picker("How to split", selection: $s.mode) {
                ForEach(SplitMode.allCases) { Text($0.short).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        } header: {
            Text("Split \(s.mode.title)")
        } footer: {
            Text(s.mode.hint)
        }

        if s.mode == .itemized {
            itemSections
        } else {
            Section {
                ForEach(people) { mem in row(mem) }
            } header: {
                header
            } footer: {
                status
            }
        }
    }

    // MARK: people

    @ViewBuilder private var header: some View {
        if s.mode == .equal || s.mode == .adjust {
            let everyone = s.among.count == people.count
            HStack {
                Text("Between · \(s.among.count)")
                Spacer()
                Button(everyone ? "Nobody" : "Everyone") {
                    s.among = everyone ? [] : Set(people.map(\.userId))
                }
                .font(.footnote.weight(.semibold)).textCase(nil)
            }
        } else {
            Text("Each person")
        }
    }

    @ViewBuilder private func row(_ mem: Member) -> some View {
        let u = mem.userId
        switch s.mode {
        case .equal:
            let on = s.among.contains(u)
            Button { toggle(u) } label: {
                person(mem, sub: nil) {
                    if on, let v = shares[u] { Text(money(v)).monospacedDigit().foregroundStyle(.secondary) }
                    check(on)
                }
            }
        case .adjust:
            let on = s.among.contains(u)
            person(mem, sub: on ? shares[u].map(money) : nil) {
                if on { field(bind(\.adjust, u), "+0", suffix: cur, keyboard: .numbersAndPunctuation) }
                Button { toggle(u) } label: { check(on) }.buttonStyle(.borderless)
            }
        case .exact:
            person(mem, sub: nil) { field(bind(\.exact, u), "0,00", suffix: cur) }
        case .percent:
            person(mem, sub: shares[u].map(money)) { field(bind(\.percent, u), "0", suffix: "%") }
        case .shares:
            person(mem, sub: shares[u].map(money)) { field(bind(\.shares, u), "0", suffix: "×") }
        case .itemized:
            EmptyView()
        }
    }

    private func toggle(_ u: String) {
        Haptic.tap()
        if s.among.contains(u) { s.among.remove(u) } else { s.among.insert(u) }
    }

    private func check(_ on: Bool) -> some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
            .font(.title3).foregroundStyle(on ? Color.accentColor : Color.secondary)
    }

    private func person(_ mem: Member, sub: String?, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 12) {
            AvatarView(name: mem.displayName, seed: mem.userId, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(name(mem.userId)).foregroundStyle(.primary)
                if let sub { Text(sub).font(.caption).monospacedDigit().foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            trailing()
        }
    }

    private func bind(_ key: WritableKeyPath<SplitState, [String: String]>, _ u: String) -> Binding<String> {
        Binding(get: { s[keyPath: key][u] ?? "" }, set: { s[keyPath: key][u] = $0 })
    }

    private func field(_ text: Binding<String>, _ placeholder: String, suffix: String, keyboard: UIKeyboardType = .decimalPad) -> some View {
        HStack(spacing: 4) {
            TextField(placeholder, text: text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 80)
            Text(suffix).font(.subheadline).foregroundStyle(.secondary)
        }
    }

    // MARK: items

    @ViewBuilder private var itemSections: some View {
        ForEach($s.lines) { $line in
            Section {
                HStack {
                    TextField("Item, e.g. Pizza", text: $line.label)
                    field($line.amount, "0,00", suffix: cur)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(people) { mem in
                            let on = line.among.contains(mem.userId)
                            Button {
                                Haptic.tap()
                                if on { line.among.remove(mem.userId) } else { line.among.insert(mem.userId) }
                            } label: {
                                Text(name(mem.userId))
                                    .font(.subheadline.weight(.medium))
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(on ? Color.accentColor : Color.secondary.opacity(0.15), in: Capsule())
                                    .foregroundStyle(on ? Color.white : Color.primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if s.lines.count > 1 {
                    Button("Remove item", role: .destructive) { s.lines.removeAll { $0.id == line.id } }
                        .font(.subheadline)
                }
            } header: {
                if line.id == s.lines.first?.id { Text("Items") }
            }
        }
        Section {
            Button { s.lines.append(.init(among: Set(people.map(\.userId)))) } label: { Label("Add item", systemImage: "plus.circle.fill") }
        }
        Section {
            extra("Tax", $s.tax)
            extra("Tip", $s.tip)
            extra("Discount", $s.discount)
        } header: {
            Text("Shared in proportion")
        } footer: {
            status
        }
        if !shares.isEmpty {
            Section("Each person") {
                ForEach(people.filter { shares[$0.userId] != nil }) { mem in
                    person(mem, sub: nil) { Text(money(shares[mem.userId] ?? 0)).monospacedDigit().foregroundStyle(.secondary) }
                }
            }
        }
    }

    private func extra(_ label: String, _ text: Binding<String>) -> some View {
        HStack { Text(label); Spacer(); field(text, "0,00", suffix: cur) }
    }

    // MARK: does it add up

    @ViewBuilder private var status: some View {
        let (text, ok, fix) = verdict
        VStack(alignment: .leading, spacing: 6) {
            if let text {
                Label(text, systemImage: ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .foregroundStyle(ok ? Color.green : Color.red)
            }
            if let fix {
                Button("Make the total \(money(fix))") { setTotal(fix) }.font(.footnote.weight(.semibold))
            }
        }
    }

    /// one line about whether the split adds up, and, for a receipt, the total that would make it
    private var verdict: (String?, Bool, Int?) {
        if let u = unreadable {
            let what = ["tax": "The tax", "tip": "The tip", "discount": "The discount", "item": "An item's amount"][u] ?? "\(name(u))'s figure"
            return ("\(what) isn't a number.", false, nil)
        }
        let items = s.lines.compactMap { SplitState.read($0.amount, cur) }.reduce(0, +)
        let extras = (SplitState.read(s.tax, cur) ?? 0) + (SplitState.read(s.tip, cur) ?? 0) - (SplitState.read(s.discount, cur) ?? 0)
        if total <= 0 {
            // a receipt can set the total instead of being checked against it
            if s.mode == .itemized && items + extras > 0 { return ("Enter the total, or use the receipt's.", false, items + extras) }
            return (nil, false, nil)
        }
        switch result {
        case .ok:
            switch s.mode {
            case .exact: return ("Adds up to \(money(total)).", true, nil)
            case .percent: return ("Adds up to 100 %.", true, nil)
            case .itemized: return ("Items, tax and tip come to \(money(total)).", true, nil)
            default: return (nil, true, nil)
            }
        case .failed(let e):
            switch e {
            case .empty:
                switch s.mode {
                case .equal, .adjust: return ("Tick at least one person.", false, nil)
                case .exact: return ("Type what each person owes.", false, nil)
                case .percent: return ("Give each person a percentage.", false, nil)
                case .shares: return ("Give at least one person a share.", false, nil)
                case .itemized:
                    return (s.lines.isEmpty ? "Add at least one item." : "Tick who had each item.", false, nil)
                }
            case .sumMismatch(let diff):
                if s.mode == .itemized {
                    return ("The receipt comes to \(money(total + diff)), not \(money(total)).", false, total + diff)
                }
                return (diff < 0 ? "\(money(-diff)) of \(money(total)) still to assign." : "\(money(diff)) more than the total.", false, nil)
            case .percentTotal(let diff):
                let pct = Money.input(abs(diff), "EUR").replacingOccurrences(of: ",00", with: "")
                return (diff < 0 ? "\(pct) % still to assign." : "\(pct) % too much.", false, nil)
            case .remainderNegative(let diff):
                return ("The adjustments are \(money(diff)) more than the total.", false, nil)
            case .badValue(let who):
                switch s.mode {
                case .percent: return ("Percentages go from 0 to 100.", false, nil)
                case .shares: return ("Shares are numbers like 1, 2 or 1,5.", false, nil)
                default: return (who.map { "Check \(name($0))'s amount." } ?? "Check the amounts.", false, nil)
                }
            case .notInSplit(let who): return ("Tick \(name(who)) to give them an adjustment.", false, nil)
            case .tooLarge: return ("That amount is too large.", false, nil)
            case .unknownType: return ("This app can't edit that kind of split.", false, nil)
            }
        }
    }
}

/// "Paid by several people": what each of them put down, and whether it adds up to the bill.
struct PayersEditor: View {
    @Binding var s: SplitState
    let people: [Member]
    let total: Int
    let cur: String
    let name: (String) -> String

    var body: some View {
        let paid = s.payers(cur)
        let sum = paid?.values.reduce(0, +) ?? 0
        Section {
            ForEach(people) { mem in
                HStack(spacing: 12) {
                    AvatarView(name: mem.displayName, seed: mem.userId, size: 30)
                    Text(name(mem.userId))
                    Spacer(minLength: 8)
                    HStack(spacing: 4) {
                        TextField("0,00", text: Binding(get: { s.paid[mem.userId] ?? "" }, set: { s.paid[mem.userId] = $0 }))
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing).monospacedDigit().frame(width: 80)
                        Text(cur).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Who paid")
        } footer: {
            let m = { (v: Int) in Fmt.money(Money.toMajor(v, cur), cur) }
            if paid == nil {
                Label("One of the amounts isn't a number.", systemImage: "exclamationmark.circle.fill").foregroundStyle(.red)
            } else if total > 0 && sum == total {
                Label("Adds up to \(m(total)).", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            } else if total > 0 {
                Label(sum < total ? "\(m(total - sum)) of \(m(total)) still to assign." : "\(m(sum - total)) more than the total.",
                      systemImage: "exclamationmark.circle.fill").foregroundStyle(.red)
            }
        }
    }
}
