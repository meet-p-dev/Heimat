import SwiftUI
import UniformTypeIdentifiers

/// Import from Splitwise: pick the group's export, check what's in it, say which one is you
/// (the web app's SplitwiseImportModal).
struct SplitwiseImportView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var file: SplitwiseImport.File?
    @State private var text = ""
    @State private var me: String?
    @State private var name = ""
    @State private var kind = "group"
    @State private var error: String?

    private static let errors: [SplitwiseImport.Failure: String] = [
        .notSplitwise: "That doesn't look like a Splitwise export. In Splitwise, export the group as a spreadsheet (CSV) and pick that file.",
        .empty: "There are no expenses in that file.",
        .tooLarge: "That group has more than 5,000 expenses — too many to bring over in one go.",
    ]

    var body: some View {
        NavigationStack {
            Form {
                if let f = file { preview(f) } else { start }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Import from Splitwise")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if let f = file {
                    ToolbarItem(placement: .confirmationAction) {
                        AsyncButton(action: {
                            guard let me else { return }
                            error = await m.importSplitwise(f, me: me, name: name, kind: kind, text: text)
                        }) { Text("Import") }
                        .disabled(me == nil)
                    }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText, .text]) { r in
                guard case .success(let url) = r else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url), data.count <= 10_000_000,
                      let t = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { error = "Couldn't read that file."; return }
                read(t, fileName: url.lastPathComponent)
            }
            .onAppear {
                // -HeimatSplitwise: the preview with a made-up group, for looking at it in the simulator
                if AppModel.fixtureMode, ProcessInfo.processInfo.arguments.contains("-HeimatSplitwise"), file == nil { read(Self.sample, fileName: "sunny-wg_2025-05-03_export.csv") }
            }
        }
    }

    private func read(_ t: String, fileName: String) {
        switch SplitwiseImport.run(t, fileName: fileName) {
        case .failure(let e): file = nil; error = Self.errors[e]
        case .success(let f):
            error = nil; text = t; file = f; name = f.name
            me = SplitwiseImport.guessMe(f.people, m.profile.name)
        }
    }

    private var start: some View {
        Group {
            Section {
                Text("Bring a group over with every expense and payment, on its original date — balances stay exactly as they were.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Section {
                Text("1. Open the group")
                VStack(alignment: .leading, spacing: 2) {
                    Text("2. Settings → Export as spreadsheet")
                    Text("On splitwise.com it's under the group's settings").font(.caption).foregroundStyle(.secondary)
                }
                Text("3. Save the CSV file, then pick it here")
            } header: { Text("In Splitwise") } footer: { Text("The file is read on this phone. Only the expenses go to your new group.") }
            Section {
                Button { picking = true } label: { Label("Choose the file", systemImage: "square.and.arrow.down") }
            }
        }
    }

    @ViewBuilder private func preview(_ f: SplitwiseImport.File) -> some View {
        Section("Name") {
            TextField("From Splitwise", text: $name)
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
        } header: { Text(SplitwiseImport.summary(f)) } footer: {
            if let a = f.from, let b = f.to { Text(a.prefix(7) == b.prefix(7) ? Self.month(a) : "\(Self.month(a)) – \(Self.month(b))") }
        }
        Section {
            switch f.totals {
            case .yes: Label("Matches Splitwise's own totals", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
            case .rounding: Label("Within a few cents of Splitwise's totals — Splitwise rounds its total row.", systemImage: "info.circle").foregroundStyle(.orange)
            case .no: Label("These balances differ from the total row in the file. Check them before importing.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            case .none: EmptyView()
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

    private struct Line: Identifiable { let p: SplitwiseImport.Person; let cur: String; let minor: Int; var id: String { "\(p.key)|\(cur)" } }
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
struct SplitwiseImportsSection: View {
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
                                Text([r.expenses > 0 ? "\(r.expenses) expense\(r.expenses == 1 ? "" : "s")" : "", r.payments > 0 ? "\(r.payments) payment\(r.payments == 1 ? "" : "s")" : ""]
                                    .filter { !$0.isEmpty }.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: { Text("Imported from Splitwise") } footer: { Text("You can take an import back until someone else joins the group.") }
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
