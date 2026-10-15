import SwiftUI
import UniformTypeIdentifiers

/// The apps people come from, and how to get the file out of each (the web app's APPS in
/// ImportGroupModal.tsx); "other" is any spreadsheet.
enum ImportApp: String, CaseIterable, Identifiable {
    case splitwise, tricount, settleup, splid, other
    var id: String { rawValue }
    var name: String {
        switch self {
        case .splitwise: "Splitwise"
        case .tricount: "Tricount"
        case .settleup: "Settle Up"
        case .splid: "Splid"
        case .other: "A spreadsheet"
        }
    }
    /// mid-sentence: "from Splitwise", "from a spreadsheet"
    var inSentence: String { self == .other ? "a spreadsheet" : name }
    var steps: [String] {
        switch self {
        case .splitwise: ["Open the group", "Settings → Export as spreadsheet", "Save the CSV file, then pick it here"]
        case .tricount: ["Open the tricount", "Look for Export in its settings (Excel or CSV)", "No export in your app? Tricount support can send you the file"]
        case .settleup: ["Open the group", "Menu → Export — it emails you a CSV (Excel with Premium)", "Save the file, then pick it here"]
        case .splid: ["Open the group", "Export → Excel", "Save the file, then pick it here"]
        case .other: ["Any CSV or Excel file with a date, an amount and who paid", "If its columns aren't recognised, you pick which is which"]
        }
    }
}

/// Import a group: which app, pick the export, check what's in it, say which one is you
/// (the web app's ImportGroupModal).
struct ImportGroupView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var app: ImportApp?
    @State private var picking = false
    @State private var file: ExpenseImport.File?
    @State private var table: [[String]]?
    @State private var map = ExpenseImport.ColumnMap()
    @State private var fileName = ""
    @State private var hash = ""
    @State private var me: String?
    @State private var name = ""
    @State private var kind = "group"
    @State private var error: String?

    private static let fields: [(WritableKeyPath<ExpenseImport.ColumnMap, Int>, String, Bool)] = [
        (\.date, "Date", true), (\.amount, "Amount", true), (\.payer, "Who paid", true), (\.description, "Description", false),
        (\.forWhom, "For whom (empty: everyone)", false), (\.currency, "Currency", false), (\.category, "Category", false),
    ]
    private var currency: String { m.profile.hostCur.isEmpty ? "EUR" : m.profile.hostCur }

    var body: some View {
        NavigationStack {
            Form {
                if let f = file { preview(f) }
                else if let table { columns(table) }
                else if let app { start(app) }
                else { apps }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle(app.map { "Import from \($0.inSentence)" } ?? "Import a group")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if let f = file, let app {
                    ToolbarItem(placement: .confirmationAction) {
                        AsyncButton(action: {
                            guard let me else { return }
                            error = await m.importGroup(f, me: me, name: name, kind: kind, hash: hash, source: app.rawValue)
                        }) { Text("Import") }
                        .disabled(me == nil)
                    }
                } else if table != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Read") { readMapped() }.disabled(Self.fields.contains { $0.2 && map[keyPath: $0.0] < 0 })
                    }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .tabSeparatedText, .plainText, .text,
                                                                     UTType(filenameExtension: "xlsx") ?? .data]) { r in
                guard case .success(let url) = r else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url), data.count <= 10_000_000 else { error = "Couldn't read that file."; return }
                read(data, fileName: url.lastPathComponent)
            }
            .onAppear {
                // -HeimatSplitwise: the preview with a made-up group, for looking at it in the simulator
                if AppModel.isDemo, ProcessInfo.processInfo.arguments.contains("-HeimatSplitwise"), file == nil {
                    app = .splitwise
                    read(Data(Self.sample.utf8), fileName: "sunny-wg_2025-05-03_export.csv")
                }
            }
        }
    }

    private func reset() { file = nil; table = nil; error = nil; me = nil; name = ""; kind = "group"; map = .init() }

    private func got(_ r: ExpenseImport.Result, table t: [[String]]) {
        switch r {
        case .ok(let f): error = nil; table = nil; file = f; name = f.name; me = ExpenseImport.guessMe(f.people, m.profile.name)
        case .empty: error = "There are no expenses in that file."
        case .tooLarge: error = "That group has more than 5,000 expenses — too many to bring over in one go."
        case .notRecognised: error = nil; table = t
        }
    }

    private func read(_ data: Data, fileName: String) {
        reset()
        self.fileName = fileName
        if Xlsx.isZip(data) {
            guard let sheets = try? Xlsx.read(data) else { error = "That file couldn't be opened. Pick a CSV or Excel (.xlsx) file."; return }
            hash = AppModel.importHash(data)
            // columns are picked on the sheet with the most rows
            let filled = { (s: [[String]]) in s.filter { $0.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }.count }
            got(ExpenseImport.sheets(sheets, fileName: fileName, currency: currency), table: sheets.max { filled($0) < filled($1) } ?? [])
        } else {
            let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1252) ?? ""
            hash = AppModel.importHash(text)
            got(ExpenseImport.csv(text, fileName: fileName, currency: currency), table: ExpenseImport.csvTable(text))
        }
    }

    private func readMapped() {
        guard let table else { return }
        switch ExpenseImport.table(table, fileName: fileName, currency: currency, map: map) {
        case .ok(let f): got(.ok(f), table: table)
        default: error = "Those columns didn't give any expenses — check which is which."
        }
    }

    private var apps: some View {
        Group {
            Section {
                Text("Bring a group over with every expense and payment, on its original date — balances stay exactly as they were.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Section("Where from?") {
                ForEach(ImportApp.allCases) { a in
                    Button { app = a } label: {
                        HStack { Text(a.name).foregroundStyle(.primary); Spacer(); Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
                    }
                }
                .tint(.primary)
            }
        }
    }

    @ViewBuilder private func start(_ a: ImportApp) -> some View {
        Section {
            ForEach(Array(a.steps.enumerated()), id: \.offset) { i, s in Text(a == .other ? s : "\(i + 1). \(s)") }
        } header: { Text(a == .other ? "What works" : "In \(a.name)") } footer: { Text("The file is read on this phone. Only the expenses go to your new group.") }
        Section {
            Button { picking = true } label: { Label("Choose the file", systemImage: "square.and.arrow.down") }
            Button { reset(); app = nil } label: { Label("Another app", systemImage: "chevron.left") }.tint(.secondary)
        }
    }

    @ViewBuilder private func columns(_ t: [[String]]) -> some View {
        let head = t.first { $0.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } } ?? []
        Section {
            ForEach(Self.fields, id: \.1) { key, label, required in
                Picker(label, selection: Binding(get: { map[keyPath: key] }, set: { map[keyPath: key] = $0 })) {
                    Text(required ? "Choose…" : "—").tag(-1)
                    ForEach(Array(head.enumerated()), id: \.offset) { i, h in
                        Text(h.trimmingCharacters(in: .whitespaces).isEmpty ? "Column \(i + 1)" : h).tag(i)
                    }
                }
            }
        } header: { Text("Which column is what?") } footer: { Text("Splitlife didn't recognise this file's columns.") }
    }

    @ViewBuilder private func preview(_ f: ExpenseImport.File) -> some View {
        Section("Name") {
            TextField("Group name", text: $name)
            Picker("It's a", selection: $kind) { Text("Group").tag("group"); Text("Flat").tag("flat") }
                .pickerStyle(.segmented)
        }
        Section {
            ForEach(f.people, id: \.key) { p in
                Button { me = p.key } label: {
                    HStack(spacing: 12) {
                        AvatarView(name: p.name, seed: p.name, size: 32)
                        Text(p.name).foregroundStyle(.primary)
                        Spacer()
                        Image(systemName: me == p.key ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(me == p.key ? Color.accentColor : .secondary).font(.title3)
                    }
                }
            }
            .tint(.primary)
        } header: { Text("Which one is you?") } footer: {
            Text("Everyone else is added waiting to join. Send each of them their invite link from the group — they take over their name and see the whole history.")
        }
        Section {
            let lines = f.people.flatMap { p in f.currencies.map { Line(p: p, cur: $0, minor: f.balances["\(p.key)|\($0)"] ?? 0) } }.filter { $0.minor != 0 }
            if lines.isEmpty { Text("Everyone is settled up") }
            ForEach(lines) { l in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(l.p.key == me ? "You" : l.p.name)
                        Text(l.minor > 0 ? "gets back" : "owes").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Fmt.money(Money.toMajor(abs(l.minor), l.cur), l.cur)).fontWeight(.semibold)
                        .foregroundStyle(l.minor > 0 ? Color.green : Color.red)
                }
            }
        } header: { Text(ExpenseImport.summary(f)) } footer: {
            if let a = f.from, let b = f.to { Text(a.prefix(7) == b.prefix(7) ? Self.month(a) : "\(Self.month(a)) – \(Self.month(b))") }
        }
        Section {
            switch f.totals {
            case .yes: Label("Matches the file's own totals", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
            case .rounding: Label("Within a few cents of the file's totals — Splitwise rounds its total row.", systemImage: "info.circle").foregroundStyle(.orange)
            case .no: Label("These balances differ from the total row in the file. Check them before importing.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            case .none: Text("Check these balances against \(app == .other ? "your spreadsheet" : app?.name ?? "the other app") before importing.").font(.footnote).foregroundStyle(.secondary)
            }
            if !f.bad.isEmpty {
                Text("\(f.bad.count) row\(f.bad.count == 1 ? "" : "s") couldn't be read and \(f.bad.count == 1 ? "was" : "were") left out (line \(f.bad.prefix(5).map(String.init).joined(separator: ", "))\(f.bad.count > 5 ? "…" : "")).")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if f.skipped > 0 {
                Text("\(f.skipped) row\(f.skipped == 1 ? "" : "s") didn't change anyone's balance and \(f.skipped == 1 ? "was" : "were") left out.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private struct Line: Identifiable { let p: ExpenseImport.Person; let cur: String; let minor: Int; var id: String { "\(p.key)|\(cur)" } }
    /// "Mar 2025"
    private static func month(_ ymd: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        guard let d = f.date(from: ymd) else { return ymd }
        return d.formatted(.dateTime.month(.abbreviated).year())
    }

    /// made-up people only
    static let sample = """
    Date,Description,Category,Cost,Currency,Alex Kim,Priya Nair,Tom Berg
    2025-03-01,Rewe,Groceries,30.00,EUR,20.00,-10.00,-10.00
    2025-03-02,Rent March,Rent,900.00,EUR,300.00,0.00,-300.00
    2025-03-04,Priya N. paid Alex K.,Payment,10.00,EUR,-10.00,10.00,0.00
    2025-03-05,Pizza,Dining out,10.00,EUR,6.67,-3.33,-3.34
    2025-04-10,Train to Hamburg,Bus/train,58.00,EUR,-29.00,29.00,0.00

    ,Total balance, , ,EUR,287.67,25.67,-313.34
    """
}

/// Settings → Export & import: imports you can still take back (until someone else joins)
struct GroupImportsSection: View {
    @Environment(AppModel.self) private var m
    @State private var rows: [AppModel.ImportRecord] = []
    @State private var removing: AppModel.ImportRecord?

    var body: some View {
        Group {
            if !rows.isEmpty {
                Section {
                    ForEach(rows) { r in
                        Button(role: .destructive) { removing = r } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Remove \(name(r))")
                                Text(([ImportApp(rawValue: r.source ?? "").map { "from \($0.inSentence)" } ?? "",
                                       r.expenses > 0 ? "\(r.expenses) expense\(r.expenses == 1 ? "" : "s")" : "",
                                       r.payments > 0 ? "\(r.payments) payment\(r.payments == 1 ? "" : "s")" : ""])
                                    .filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: { Text("Imported groups") } footer: { Text("You can take an import back until someone else joins the group.") }
            }
        }
        .task { rows = await m.myImports() }
        .confirmationDialog(removing.map { "Remove \(name($0))? The group and everything in it goes — the imported expenses and anything added since. You can import the file again later." } ?? "",
                            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                guard let r = removing else { return }
                Task { if await m.removeImport(r) { rows = await m.myImports() } }
                removing = nil
            }
        }
    }
    private func name(_ r: AppModel.ImportRecord) -> String { m.flats.first { $0.id == r.flatId }?.name ?? "the group" }
}
