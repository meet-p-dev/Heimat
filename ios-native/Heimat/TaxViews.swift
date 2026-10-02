import SwiftUI
import JavaScriptCore

// MARK: - Tax estimate (Germany, 2026)

/// Tax details for the monthly estimate — the same fields as src/lib/tax/estimate.ts.
struct TaxDetails: Codable, Equatable {
    var taxClass = 1
    var church = false
    var churchRate = 0.09
    var kvz = 2.9
    var children = 0
    var over23 = true
    var sachsen = false
    var minijobPensionOptOut = true
}

/// How one employer employs you, and whether it's your main job (the others are class VI).
struct JobSetting: Codable, Equatable { var kind: String; var main: Bool }

/// What the employer withholds this month, per job and in all.
struct MonthTax: Decodable {
    struct Job: Decodable { let employer: String; let gross, tax, soli, churchTax, health, care, pension, unemployment, net: Double; let taxClass: Int; let notes: [String] }
    let jobs: [Job]
    let gross, tax, soli, churchTax, social, net: Double
}

/// Runs the web app's own calculation (ios-native/Heimat/tax.js, packed from src/lib/tax by
/// scripts/bundle-tax.sh) in JavaScriptCore: one implementation of the Finance Ministry's
/// plan for both apps, checked to the cent against its calculator in tests/lohnsteuer.test.ts.
enum TaxEngine {
    static let kinds: [(id: String, label: String, sub: String)] = [
        ("werkstudent", "Working student", "Enrolled, up to 20 h a week in term: pension only"),
        ("minijob", "Minijob", "Up to 603 € a month: nothing comes off"),
        ("regular", "Regular job", "Full contributions (Midijob rules apply by themselves)"),
        ("shortterm", "Short-term job", "Up to 3 months / 70 days a year: no contributions"),
    ]

    private static let context: JSContext? = {
        guard let url = Bundle.main.url(forResource: "tax", withExtension: "js"),
              let src = try? String(contentsOf: url, encoding: .utf8), let c = JSContext() else { return nil }
        c.evaluateScript(src)
        return c.objectForKeyedSubscript("SplitlifeTax").isUndefined ? nil : c
    }()

    static func month(_ jobs: [(employer: String, gross: Double, kind: String, main: Bool)], _ d: TaxDetails) -> MonthTax? {
        guard let c = context else { return nil }
        let js = jobs.map { ["employer": $0.employer, "gross": $0.gross, "kind": $0.kind, "main": $0.main] as [String: Any] }
        let p: [String: Any] = ["taxClass": d.taxClass, "church": d.church, "churchRate": d.churchRate, "kvz": d.kvz,
                                "children": d.children, "over23": d.over23, "sachsen": d.sachsen, "minijobPensionOptOut": d.minijobPensionOptOut]
        guard let a = try? JSONSerialization.data(withJSONObject: js), let b = try? JSONSerialization.data(withJSONObject: p),
              let out = c.evaluateScript("JSON.stringify(SplitlifeTax.monthDeductions(\(String(decoding: a, as: UTF8.self)), \(String(decoding: b, as: UTF8.self))))")?.toString(),
              let data = out.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(MonthTax.self, from: data)
    }
}

extension AppModel {
    /// each employer this month: what it paid, its kind, and which one is the main job
    var monthJobs: [(employer: String, gross: Double, kind: String, main: Bool)] {
        let month = String(Fmt.today().prefix(7))
        var by: [String: Double] = [:]
        for s in shifts where s.date.hasPrefix(month) { by[s.employer.isEmpty ? "Job" : s.employer, default: 0] += Calc.shift(s).pay }
        let jobs = profile.jobs ?? [:]
        let student = (profile.doing ?? ["study"]).contains("study")
        let names = by.keys.sorted { (by[$0] ?? 0, $1) > (by[$1] ?? 0, $0) }
        let main = names.first { jobs[$0]?.main == true } ?? names.first
        return names.map { n in (n, ((by[n] ?? 0) * 100).rounded() / 100, jobs[n]?.kind ?? (student ? "werkstudent" : "regular"), n == main) }
    }
}

/// The Work tab's card: this month after tax and contributions.
struct TaxCard: View {
    @Environment(AppModel.self) private var m
    @State private var open = false

    var body: some View {
        let t = m.profile.tax.flatMap { TaxEngine.month(m.monthJobs, $0) }
        HeimatCard(radius: 22, padding: 14, action: { open = true }) {
            HStack(spacing: 13) {
                SettingIcon(symbol: "building.columns.fill", color: .indigo)
                VStack(alignment: .leading, spacing: 2) {
                    if let t, t.gross > 0 {
                        Text("This month after deductions · estimate").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.secondary)
                        Text("≈ \(m.fH(t.net))").font(.system(size: 20, weight: .bold)).monospacedDigit()
                        Text("of \(m.fH(t.gross)) · tax \(m.fH(t.tax + t.soli + t.churchTax)) · social \(m.fH(t.social))")
                            .font(.system(size: 12.5)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                    } else {
                        Text(m.profile.tax == nil ? "What comes off your pay?" : "No shifts this month yet").font(.system(size: 15, weight: .semibold))
                        Text(m.profile.tax == nil ? "Add your tax details once — about a minute" : "Log a shift to see this month after tax")
                            .font(.system(size: 12.5)).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .sheet(isPresented: $open) { TaxSheet() }
    }
}

struct TaxSheet: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss

    private var d: TaxDetails { m.profile.tax ?? TaxDetails() }
    private func set(_ f: (inout TaxDetails) -> Void) { var p = m.profile; var t = p.tax ?? TaxDetails(); f(&t); p.tax = t; m.saveProfile(p) }
    private func setJob(_ name: String, kind: String? = nil, main: Bool? = nil) {
        var p = m.profile
        var all = p.jobs ?? [:]
        let cur = m.monthJobs.first { $0.employer == name }
        if main == true { for k in all.keys { all[k]?.main = false } }
        var j = all[name] ?? JobSetting(kind: cur?.kind ?? "werkstudent", main: cur?.main ?? false)
        if let kind { j.kind = kind }
        if let main { j.main = main }
        all[name] = j
        p.jobs = all
        if p.tax == nil { p.tax = TaxDetails() }
        m.saveProfile(p)
    }

    var body: some View {
        let jobs = m.monthJobs
        let t = m.profile.tax.flatMap { TaxEngine.month(jobs, $0) }
        NavigationStack {
            Form {
                if let t, !t.jobs.isEmpty {
                    Section {
                        ForEach(t.jobs, id: \.employer) { j in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text("\(j.employer) · class \(["", "I", "II", "III", "IV", "V", "VI"][j.taxClass])").font(.headline)
                                    Spacer()
                                    Text("\(m.fH(j.net)) of \(m.fH(j.gross))").monospacedDigit().foregroundStyle(.secondary)
                                }
                                Text("Tax \(m.fH(j.tax))" + (j.soli > 0 ? " · soli \(m.fH(j.soli))" : "") + (j.churchTax > 0 ? " · church \(m.fH(j.churchTax))" : "")
                                     + " · health \(m.fH(j.health + j.care)) · pension \(m.fH(j.pension))" + (j.unemployment > 0 ? " · unempl. \(m.fH(j.unemployment))" : ""))
                                    .font(.caption).foregroundStyle(.secondary)
                                ForEach(j.notes, id: \.self) { Text($0).font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                    } header: { Text("This month, estimated") } footer: {
                        Text("An employer works out each month as if you earned that much all year, so a busy month has more taken off than the year will owe — a tax return gives it back. Germany, 2026 rules.")
                    }
                }
                if !jobs.isEmpty {
                    Section {
                        ForEach(jobs, id: \.employer) { j in
                            Picker(selection: Binding(get: { j.kind }, set: { setJob(j.employer, kind: $0) })) {
                                ForEach(TaxEngine.kinds, id: \.id) { k in Text(k.label).tag(k.id) }
                            } label: {
                                HStack {
                                    Text(j.employer)
                                    if j.main { Text("main").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2).background(Color.accentColor.opacity(0.18), in: Capsule()) }
                                }
                            }
                            .swipeActions { if !j.main { Button("Make main") { setJob(j.employer, main: true) }.tint(.accentColor) } }
                        }
                    } header: { Text("Your jobs") } footer: { Text("Your main job uses your tax class; any other job is taxed in class VI. Swipe a job to make it the main one.") }
                }
                Section {
                    Picker("Tax class", selection: Binding(get: { d.taxClass }, set: { v in set { $0.taxClass = v } })) {
                        ForEach(1...6, id: \.self) { Text(["", "I", "II", "III", "IV", "V", "VI"][$0]).tag($0) }
                    }.pickerStyle(.segmented)
                    Toggle("Church member", isOn: Binding(get: { d.church }, set: { v in set { $0.church = v } }))
                    if d.church { Toggle("I live in Bavaria or Baden-Württemberg", isOn: Binding(get: { d.churchRate == 0.08 }, set: { v in set { $0.churchRate = v ? 0.08 : 0.09 } })) }
                    Stepper("Children under 25: \(d.children)", value: Binding(get: { d.children }, set: { v in set { $0.children = v } }), in: 0...9)
                    Toggle("23 or older", isOn: Binding(get: { d.over23 }, set: { v in set { $0.over23 = v } }))
                    Toggle("I work in Saxony", isOn: Binding(get: { d.sachsen }, set: { v in set { $0.sachsen = v } }))
                    Toggle("Minijob: freed from the pension contribution", isOn: Binding(get: { d.minijobPensionOptOut }, set: { v in set { $0.minijobPensionOptOut = v } }))
                    Stepper("Health fund's extra: \(Fmt.num(d.kvz, 1)) %", value: Binding(get: { d.kvz }, set: { v in set { $0.kvz = (v * 10).rounded() / 10 } }), in: 0...6, step: 0.1)
                } header: { Text("About you") } footer: {
                    Text("Your tax class is on your payslip. The health fund's extra contribution (Zusatzbeitrag) is 2,9 % on average in 2026. Church tax is 9 % (8 % in Bavaria and Baden-Württemberg).")
                }
            }
            .navigationTitle("Tax & contributions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { if m.profile.tax == nil { set { _ in } }; dismiss() } } }
        }
    }
}
