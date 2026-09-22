import SwiftUI

struct WorkView: View {
    @Environment(AppModel.self) private var m
    enum Span: String, CaseIterable, Identifiable { case month = "M", year = "Y", all = "∞"; var id: String { rawValue } }
    enum Gran: String, CaseIterable, Identifiable { case day = "Day", week = "Week", month = "Month", year = "Year"; var id: String { rawValue } }
    @State private var span: Span = .month
    @State private var gran: Gran = .month

    var body: some View {
        let ws = m.work
        return NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    hero(ws)
                    logButton
                    smallStats(ws)
                    compliance(ws)
                    history
                    if !ws.byEmployer.isEmpty { byEmployer(ws) }
                    recentShifts
                    footnote(ws)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top) { HeimatHeader(kicker: Fmt.longToday(), title: "Work") }
            .heimatScreen()
        }
    }

    /// The earnings hero: Heimat's one deliberately loud surface, a green-to-gold
    /// gradient rather than glass, so the number you came for reads first.
    private func hero(_ ws: Calc.WorkStats) -> some View {
        let v = span == .month ? ws.earnMonth : span == .year ? ws.earnYear : ws.earnAll
        let ink = Color(hex: "#06120c")
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(span == .month ? "Earned this month" : span == .year ? "Earned this year" : "Earned all-time")
                    .font(.system(size: 13.5, weight: .bold)).foregroundStyle(ink.opacity(0.75))
                Spacer()
                Picker("Period", selection: $span) { ForEach(Span.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).frame(width: 118)
            }
            Text(m.fH(v))
                .font(.system(size: 42, weight: .heavy)).monospacedDigit()
                .foregroundStyle(ink).contentTransition(.numericText(value: v))
                .lineLimit(1).minimumScaleFactor(0.6)
                .padding(.top, 6)
            HStack(alignment: .bottom) {
                Text(m.fHome(v).map { "≈ \($0)" } ?? "").font(.system(size: 13.5, weight: .semibold))
                Spacer()
                Text("gross · before tax").font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(ink.opacity(0.68))
        }
        .padding(.horizontal, 18).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(LinearGradient(colors: [.work, .gold], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay {
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(RadialGradient(colors: [.white.opacity(0.35), .clear],
                                             center: .topLeading, startRadius: 0, endRadius: 320))
                }
        }
        .shadow(color: Color.work.opacity(0.35), radius: 18, y: 10)
    }

    private var logButton: some View {
        Button { m.sheet = .shift(nil, nil) } label: {
            Label("Log a work shift", systemImage: "plus").frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .tint(.work)
        .controlSize(.large)
    }

    private func smallStats(_ ws: Calc.WorkStats) -> some View {
        HStack(spacing: 12) {
            miniStat("This year", m.fH(ws.earnYear))
            miniStat("Average rate", ws.avgRate > 0 ? "\(m.fH(ws.avgRate))/h" : "—")
        }
    }

    private func miniStat(_ k: String, _ v: String) -> some View {
        HeimatCard(radius: 22, padding: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(k).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.secondary)
                Text(v).font(.system(size: 20, weight: .heavy)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
        }
    }

    private func compliance(_ ws: Calc.WorkStats) -> some View {
        let left = max(Double(ws.budget) - ws.daysUsed, 0)
        let frac = ws.daysUsed.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1
        return HeimatCard(radius: 22, padding: 14) {
            HStack(spacing: 14) {
                ZStack {
                    Ring(pct: ws.daysUsed / Double(ws.budget), color: tone(ws.tone), line: 6)
                    Text(Fmt.num(ws.daysUsed, frac)).font(.system(size: 13, weight: .heavy))
                }
                .frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(Fmt.num(ws.daysUsed, frac)) of \(ws.budget) work days · \(Fmt.num(left, left.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1)) left")
                        .font(.system(size: 14.5, weight: .bold))
                        .lineLimit(2).minimumScaleFactor(0.8)
                    Text("This week \(Fmt.num(ws.weekH)) h of \(ws.weekCap) h in term")
                        .font(.system(size: 12.5))
                        .foregroundStyle(ws.weekH > Double(ws.weekCap) ? Color.hRed
                                         : ws.weekH >= Double(ws.weekCap) * 0.8 ? Color.hAmber : Color.secondary)
                }
                Spacer(minLength: 4)
                Text(ws.tone == .over ? "OVER" : ws.tone == .close ? "CLOSE" : "SAFE")
                    .font(.system(size: 11, weight: .bold)).kerning(0.5)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(tone(ws.tone).opacity(0.16), in: Capsule())
                    .foregroundStyle(tone(ws.tone))
            }
        }
    }

    private var history: some View {
        VStack(spacing: 0) {
            SectionLabel("History").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 14) {
                VStack(spacing: 0) {
                    Picker("Group by", selection: $gran) { ForEach(Gran.allCases) { Text($0.rawValue).tag($0) } }
                        .pickerStyle(.segmented)
                        .padding(.bottom, 4)
                    let rows = buckets
                    if rows.isEmpty {
                        Text("No shifts logged yet.")
                            .font(.system(size: 14)).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 14)
                    }
                    ForEach(Array(rows.enumerated()), id: \.element.key) { i, r in
                        if i > 0 { Divider() }
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.label).font(.system(size: 14.5, weight: .semibold))
                                Text("\(r.sub) · \(r.count) \(r.count == 1 ? "shift" : "shifts")")
                                    .font(.system(size: 12.5)).foregroundStyle(.tertiary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(Fmt.num(r.hours, 2)) h")
                                    .font(.system(size: 13.5, weight: .semibold)).monospacedDigit()
                                Text(m.fH(r.pay))
                                    .font(.system(size: 12.5, weight: .bold))
                                    .foregroundStyle(Color.work).monospacedDigit()
                            }
                        }
                        .padding(.vertical, 10)
                    }
                }
            }
        }
    }

    private func byEmployer(_ ws: Calc.WorkStats) -> some View {
        VStack(spacing: 0) {
            SectionLabel("This month by employer").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 16) {
                VStack(spacing: 0) {
                    ForEach(Array(ws.byEmployer.enumerated()), id: \.element.id) { i, e in
                        if i > 0 { Divider().padding(.vertical, 4) }
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(e.name).font(.system(size: 14, weight: .semibold))
                                Spacer()
                                Text(m.fH(e.pay)).font(.system(size: 14, weight: .bold)).monospacedDigit()
                            }
                            GeometryReader { g in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.fill.tertiary)
                                    Capsule()
                                        .fill(LinearGradient(colors: [.work, .gold], startPoint: .leading, endPoint: .trailing))
                                        .frame(width: g.size.width * max(ws.earnMonth > 0 ? e.pay / ws.earnMonth : 0, 0.03))
                                }
                            }
                            .frame(height: 7)
                            Text("\(Fmt.num(e.hours)) h · Ø \(m.fH(e.hours > 0 ? e.pay / e.hours : 0))/h")
                                .font(.system(size: 11.5)).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
        }
    }

    private var recentShifts: some View {
        let recent = Array(m.shifts.sorted { $0.date > $1.date }.prefix(12))
        return VStack(spacing: 0) {
            SectionLabel("Recent shifts").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 0) {
                if recent.isEmpty {
                    Text("No shifts logged yet. Log your first one and Heimat keeps count of your hours and pay.")
                        .font(.system(size: 14)).foregroundStyle(.secondary)
                        .padding(18)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(recent.enumerated()), id: \.element.id) { i, s in
                            let d = Calc.shift(s)
                            Button { m.sheet = .shift(s, nil) } label: {
                                HStack(spacing: 12) {
                                    SettingIcon(symbol: d.overnight ? "moon.fill" : "clock.fill", color: .work)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(s.employer.isEmpty ? "Shift" : s.employer)
                                            .font(.system(size: 15, weight: .semibold))
                                        Text("\(Fmt.relDay(s.date))\(s.start.isEmpty ? "" : " · \(s.start)–\(s.end)") · \(Fmt.num(d.paidHours)) h")
                                            .font(.system(size: 12.5)).foregroundStyle(.tertiary)
                                    }
                                    Spacer(minLength: 6)
                                    Text(d.pay > 0 ? m.fH(d.pay) : "no wage")
                                        .font(.system(size: 15, weight: .bold)).monospacedDigit()
                                        .foregroundStyle(d.pay > 0 ? Color.work : Color.secondary)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 11)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PressStyle())
                            .foregroundStyle(.primary)
                            .swipeActions { Button("Delete", systemImage: "trash", role: .destructive) { m.deleteShift(s.id) } }
                            if i < recent.count - 1 { RowDivider() }
                        }
                    }
                }
            }
        }
    }

    private func footnote(_ ws: Calc.WorkStats) -> some View {
        VStack(spacing: 4) {
            Text("Guidance only, not legal advice. Your limits: \(ws.budget) full days a year (a shift under 4 h counts as half) and \(ws.weekCap) h a week in term. Earnings are gross.")
                .multilineTextAlignment(.center)
            Button("Change limits") { m.sheet = .settings }
                .font(.system(size: 12, weight: .semibold))
        }
        .font(.system(size: 12))
        .foregroundStyle(.tertiary)
        .padding(.horizontal, 8).padding(.top, 8)
    }

    /// shifts bucketed most-recent-first by day, ISO week, month or year
    private var buckets: [(key: String, label: String, sub: String, count: Int, hours: Double, pay: Double)] {
        var iso = Calendar(identifier: .iso8601); iso.locale = .current
        var map: [String: (label: String, sub: String, count: Int, hours: Double, pay: Double)] = [:]
        for s in m.shifts {
            guard let d = Fmt.date(s.date) else { continue }
            let c = Calc.shift(s)
            let key: String, label: String, sub: String
            switch gran {
            case .day: key = s.date; label = d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)); sub = s.employer.isEmpty ? "Shift" : s.employer
            case .week:
                let w = iso.component(.weekOfYear, from: d), y = iso.component(.yearForWeekOfYear, from: d)
                key = String(format: "%04d-W%02d", y, w); label = "Week \(w)"; sub = "\(y)"
            case .month: key = String(s.date.prefix(7)); label = d.formatted(.dateTime.month(.wide)); sub = String(s.date.prefix(4))
            case .year: key = String(s.date.prefix(4)); label = key; sub = "Year"
            }
            var b = map[key] ?? (label, sub, 0, 0, 0)
            b.count += 1; b.hours += c.paidHours; b.pay += c.pay
            if gran == .day && !s.employer.isEmpty && b.sub != s.employer { b.sub = "\(b.count) employers" }
            map[key] = b
        }
        return map.map { (key: $0.key, label: $0.value.label, sub: $0.value.sub, count: $0.value.count, hours: $0.value.hours, pay: $0.value.pay) }
            .sorted { $0.key > $1.key }
    }
}

struct ShiftForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let editing: Shift?
    let day: String?
    @State private var date = Date()
    @State private var employer = ""
    @State private var newEmployer = false
    @State private var start = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date())!
    @State private var end = Calendar.current.date(bySettingHour: 17, minute: 0, second: 0, of: Date())!
    @State private var brk = 30
    @State private var paidBreak = false
    @State private var wage = ""
    @State private var confirmDelete = false

    private var employers: [String] { Array(Set(m.shifts.map(\.employer).filter { !$0.isEmpty })).sorted() }
    private func hm(_ d: Date) -> String { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return String(format: "%02d:%02d", c.hour!, c.minute!) }
    private func fromHM(_ s: String) -> Date? {
        let p = s.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 ? Calendar.current.date(bySettingHour: p[0], minute: p[1], second: 0, of: Date()) : nil
    }
    private var draft: Shift {
        var s = editing ?? Shift()
        s.date = Fmt.ymd(date); s.employer = employer.trimmingCharacters(in: .whitespaces)
        s.start = hm(start); s.end = hm(end); s.breakMin = Double(brk); s.paidBreak = paidBreak; s.wage = Fmt.parse(wage)
        s.hours = nil; s.pay = nil
        let c = Calc.shift(s); s.hours = c.paidHours; s.pay = c.pay
        return s
    }

    var body: some View {
        let c = Calc.shift(draft)
        NavigationStack {
            Form {
                Section { DatePicker("Date", selection: $date, displayedComponents: .date) }
                Section("Employer") {
                    if !employers.isEmpty && !newEmployer {
                        Picker("Employer", selection: $employer) { ForEach(employers, id: \.self) { Text($0).tag($0) } }
                            .onChange(of: employer) { _, e in if let w = m.shifts.first(where: { $0.employer == e && $0.wage > 0 })?.wage { wage = Fmt.input(w) } }
                        Button { newEmployer = true; employer = ""; wage = "" } label: { Label("New employer", systemImage: "plus") }
                    } else {
                        TextField("e.g. Café job", text: $employer)
                    }
                }
                Section {
                    DatePicker("Start", selection: $start, displayedComponents: .hourAndMinute)
                    DatePicker("End", selection: $end, displayedComponents: .hourAndMinute)
                    if c.overnight { Label("Overnight — ends the next day", systemImage: "moon.fill").font(.footnote).foregroundStyle(.orange) }
                }
                Section("Break") {
                    Picker("Break", selection: $brk) { ForEach([0, 15, 30, 45, 60], id: \.self) { Text($0 == 0 ? "None" : "\($0)m").tag($0) } }
                        .pickerStyle(.segmented)
                    Stepper("Break: \(brk) min", value: $brk, in: 0...240, step: 5)
                    Toggle("Break is paid", isOn: $paidBreak)
                }
                Section("Wage per hour (\(m.hostCur))") {
                    TextField("e.g. 13,50", text: $wage).keyboardType(.decimalPad).font(.title3.weight(.semibold))
                }
                Section {
                    LabeledContent("Paid hours", value: "\(Fmt.num(c.paidHours, 2)) h")
                    LabeledContent("Gross pay") { Text(m.fH(c.pay)).font(.title3.weight(.bold)).foregroundStyle(Color.work).monospacedDigit() }
                }
                if editing != nil {
                    Section { Button("Delete shift", role: .destructive) { confirmDelete = true } }
                }
            }
            .navigationTitle(editing == nil ? "Log a shift" : "Edit shift")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing == nil ? "Log" : "Save") { m.saveShift(draft); m.show(editing == nil ? "Shift logged" : "Shift updated"); dismiss() }
                        .disabled(c.paidHours <= 0)
                }
            }
            .confirmationDialog("Delete this shift?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete shift", role: .destructive) { if let e = editing { m.deleteShift(e.id) }; dismiss() }
            }
            .onAppear {
                if let s = editing {
                    date = Fmt.date(s.date) ?? Date(); employer = s.employer; newEmployer = s.employer.isEmpty
                    if let a = fromHM(s.start) { start = a }; if let b = fromHM(s.end) { end = b }
                    brk = Int(s.breakMin); paidBreak = s.paidBreak; wage = Fmt.input(s.wage)
                } else {
                    date = day.flatMap(Fmt.date) ?? Date()
                    employer = employers.first ?? ""; newEmployer = employers.isEmpty
                    if let w = m.shifts.first(where: { $0.employer == employer && $0.wage > 0 })?.wage { wage = Fmt.input(w) }
                }
            }
        }
    }
}
