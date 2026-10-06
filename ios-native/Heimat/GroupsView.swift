import SwiftUI
import ContactsUI

// MARK: - The Groups tab

/// A column of cards: each group you are in, then Non-group expenses, which is
/// always there. A card says only what you need to decide whether to open it —
/// its name, who is in it, where you stand — and the rest is one tap away.
struct GroupsView: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        @Bindable var m = m
        NavigationStack(path: $m.groupsPath) {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(m.flats) { GroupCard(flat: $0) }
                    NonGroupCard()
                    if m.profile.on(.bills) { MyBillsCard() }
                    HStack(spacing: 10) {
                        Button { m.sheet = .flat(.group) } label: {
                            Label("New group", systemImage: "plus").frame(maxWidth: .infinity)
                        }
                        .glassButton()
                        Button { m.sheet = .flat(.join) } label: {
                            Label("Join with code", systemImage: "key.fill").frame(maxWidth: .infinity)
                        }
                        .glassButton()
                    }
                    .controlSize(.large)
                    .lineLimit(1).minimumScaleFactor(0.75)
                    .disabled(m.uid == nil)
                    .padding(.top, 4)
                    if m.isAnon && m.flats.isEmpty {
                        Button("Been here before? Sign in") { m.sheet = .auth(.signin) }
                            .font(.system(size: 13.5, weight: .semibold))
                            .padding(.top, 6)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .refreshable { await m.reload() }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top) { HeimatHeader(kicker: Fmt.longToday(), title: "Groups") }
            .heimatScreen()
            .navigationDestination(for: GroupsRoute.self) { route in
                Group {
                    switch route {
                    case .group(let id): GroupPage(id: id)
                    case .nonGroup: NonGroupView()
                    case .myBills: MyBillsView()
                    case .person(let p): PersonView(person: p)
                    }
                }
                // a pushed page doesn't get the tab bar as safe area: without this its
                // last rows ("Leave …") stay under the bar however far you scroll
                .contentMargins(.bottom, GlassTabBar.clearance, for: .scrollContent)
            }
        }
    }
}

/// "you owe 4,20 €", "you're owed 12,00 €", "all settled"
struct StandingText: View {
    let minor: Int
    let currency: String
    /// about one person: "owes you" rather than "you're owed"
    var person = false
    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(minor > 0 ? (person ? "owes you" : "you're owed") : minor < 0 ? "you owe" : "all settled")
                .font(.system(size: 11.5)).foregroundStyle(.secondary)
            if minor != 0 {
                Text(Fmt.money(Money.toMajor(abs(minor), currency), currency))
                    .font(.system(size: 15, weight: .bold)).monospacedDigit()
                    .foregroundStyle(minor > 0 ? Color.hGreen : Color.hRed)
            }
        }
    }
}

/// a few overlapping faces and how many there are
struct Faces: View {
    let people: [(id: String, name: String)]
    var size: CGFloat = 26
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(people.prefix(4).enumerated()), id: \.element.id) { i, p in
                AvatarView(name: p.name, seed: p.id, size: size)
                    .overlay(Circle().strokeBorder(Color(uiColor: .systemBackground).opacity(0.7), lineWidth: 1.5))
                    .padding(.leading, i == 0 ? 0 : -size * 0.3)
                    .zIndex(Double(4 - i))
            }
        }
    }
}

struct GroupCard: View {
    @Environment(AppModel.self) private var m
    let flat: Flat

    var body: some View {
        let people = m.members(of: flat.id)
        let mine = m.myBalance(in: flat.id)
        let waiting = people.filter(\.isPending).count
        HeimatCard(radius: 24, padding: 16, action: { m.switchFlat(flat.id); m.groupsPath = [.group(flat.id)] }) {
            VStack(alignment: .leading, spacing: 12) {
                Text(flat.name)
                    .font(.system(size: 19, weight: .bold)).lineLimit(1)
                    .padding(.trailing, 92)   // room for Invite
                HStack(spacing: 10) {
                    Faces(people: people.map { ($0.userId, $0.displayName) })
                    Text("\(people.count) \(people.count == 1 ? "person" : "people")" + (waiting > 0 ? " · \(waiting) invited" : ""))
                        .font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 6)
                    StandingText(minor: mine.minor, currency: mine.currency)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                // a chore that is yours now, or someone asking you to take theirs
                if m.profile.on(.chores) {
                    let mine = m.myTurns(in: flat.id)
                    let asks = m.choreSwaps.filter { $0.flatId == flat.id && $0.toUser == m.uid }.count
                    if !mine.isEmpty || asks > 0 {
                        Label(asks > 0 ? "\(asks) swap \(asks == 1 ? "request" : "requests") for you" : "Your turn: " + mine.map(\.name).joined(separator: ", "),
                              systemImage: "sparkles")
                            .font(.system(size: 12.5, weight: .medium)).foregroundStyle(Color.accentColor).lineLimit(1)
                    }
                }
                // the bill that needs someone soonest: "Rent due in 3 days", "Internet overdue since 1 Oct"
                if m.profile.on(.bills), let next = m.nextBill(in: flat.id), next.status.state != "paid" {
                    let line = m.billLine(next.bill, next.status)
                    Label("\(next.bill.name): \(line.text)", systemImage: "doc.text.fill")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(line.urgent ? Color.orange : Color.secondary)
                        .lineLimit(1)
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            Button { m.switchFlat(flat.id); m.sheet = .invite } label: {
                Label("Invite", systemImage: "person.badge.plus").font(.system(size: 13, weight: .semibold))
            }
            .glassProminentButton()
            .controlSize(.small)
            .padding(12)
        }
        .accessibilityElement(children: .contain)
    }
}

struct NonGroupCard: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        let friends = m.friendLines
        let total = m.nonGroupTotals.first
        HeimatCard(radius: 24, padding: 16, action: { m.groupsPath = [.nonGroup] }) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Non-group expenses")
                    .font(.system(size: 19, weight: .bold)).lineLimit(1)
                    .padding(.trailing, 92)
                HStack(spacing: 10) {
                    if friends.isEmpty {
                        Image(systemName: "person.2.wave.2.fill")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
                        Text("Split anything with anyone").font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                    } else {
                        Faces(people: friends.map { ($0.userId, $0.name) })
                        Text("\(friends.count) \(friends.count == 1 ? "friend" : "friends")")
                            .font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    if !friends.isEmpty { StandingText(minor: total?.minor ?? 0, currency: total?.currency ?? m.hostCur) }
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            Button { m.startAddExpense(prefill: ExpensePrefill(people: [])) } label: {
                Label("Add", systemImage: "plus").font(.system(size: 13, weight: .semibold))
            }
            .glassProminentButton()
            .controlSize(.small)
            .padding(12)
            .disabled(m.uid == nil)
        }
    }
}

// MARK: - Non-group expenses

struct NonGroupView: View {
    @Environment(AppModel.self) private var m
    @State private var query = ""
    @State private var showSquare = false

    var body: some View {
        let friends = m.friendLines
        let open = friends.filter { !$0.square }, square = friends.filter(\.square)
        ScrollView {
            VStack(spacing: 14) {
                PersonSearch(query: $query) { pick in
                    query = ""
                    m.startAddExpense(prefill: ExpensePrefill(people: [pick]))
                }
                if query.isEmpty {
                    if !friends.isEmpty { summary }
                    if friends.isEmpty { empty } else {
                        VStack(spacing: 0) {
                            ForEach(Array(open.enumerated()), id: \.element.id) { i, f in
                                FriendRow(line: f)
                                if i < open.count - 1 || !square.isEmpty { RowDivider(inset: 66) }
                            }
                            if !square.isEmpty {
                                if showSquare {
                                    ForEach(Array(square.enumerated()), id: \.element.id) { i, f in
                                        FriendRow(line: f)
                                        if i < square.count - 1 { RowDivider(inset: 66) }
                                    }
                                } else {
                                    Button { withAnimation(.smooth) { showSquare = true } } label: {
                                        HStack {
                                            Text("\(square.count) more, all square").font(.system(size: 14)).foregroundStyle(.secondary)
                                            Spacer()
                                            Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                                        }
                                        .padding(.horizontal, 16).padding(.vertical, 13)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(PressStyle())
                                }
                            }
                        }
                        .glassSurface(in: .rect(cornerRadius: 24))
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
        }
        .refreshable { await m.reload() }
        .navigationTitle("Non-group expenses")
        .navigationBarTitleDisplayMode(.inline)
        .heimatScreen()
    }

    private var summary: some View {
        let totals = m.nonGroupTotals
        let main = totals.first
        return HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("With friends").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                if let main {
                    Text((main.minor > 0 ? "+" : "−") + Fmt.money(Money.toMajor(abs(main.minor), main.currency), main.currency))
                        .font(.system(size: 28, weight: .heavy)).monospacedDigit()
                        .foregroundStyle(main.minor > 0 ? Color.hGreen : Color.hRed)
                } else {
                    Text("All square").font(.system(size: 22, weight: .heavy))
                }
                ForEach(totals.dropFirst(), id: \.currency) { t in
                    Text((t.minor > 0 ? "+" : "−") + Fmt.money(Money.toMajor(abs(t.minor), t.currency), t.currency))
                        .font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 6)
    }

    private var empty: some View {
        HeimatCard(radius: 24, padding: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Split anything with anyone").font(.system(size: 17, weight: .bold))
                Text("A dinner, a taxi, concert tickets. Search a friend by name or email above — they don't need Splitlife yet.")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
            }
        }
    }
}

struct FriendRow: View {
    @Environment(AppModel.self) private var m
    let line: AppModel.FriendLine

    var body: some View {
        NavigationLink(value: GroupsRoute.person(line.userId)) {
            HStack(spacing: 12) {
                AvatarView(name: line.name, seed: line.userId, size: 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.name).font(.system(size: 15.5, weight: .semibold)).lineLimit(1)
                    if line.pending { Text("invited").font(.system(size: 12)).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    if let a = line.amounts.first {
                        StandingText(minor: a.minor, currency: a.currency, person: true)
                        ForEach(line.amounts.dropFirst(), id: \.currency) { b in
                            Text((b.minor > 0 ? "+" : "−") + Fmt.money(Money.toMajor(abs(b.minor), b.currency), b.currency))
                                .font(.system(size: 11.5, weight: .semibold)).monospacedDigit().foregroundStyle(.secondary)
                        }
                    } else {
                        Text("settled up").font(.system(size: 12.5)).foregroundStyle(.tertiary)
                    }
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .foregroundStyle(.primary)
    }
}

// MARK: - Finding someone

/// "Add an expense with… name or email": the people you know, filtered as you
/// type; an email address you don't know yet says whether it is on Heimat; and
/// a contact can be picked straight from the phone.
struct PersonSearch: View {
    @Environment(AppModel.self) private var m
    @Binding var query: String
    var placeholder = "Add an expense with… name or email"
    var exclude: Set<String> = []
    /// put the cursor in the field straight away (the picker opens to type in)
    var autofocus = false
    let pick: (PersonPick) -> Void
    @State private var looked: (email: String, onHeimat: Bool, name: String?)?
    @State private var looking = false
    @State private var newName = ""
    @State private var contacts = false
    @FocusState private var focused: Bool

    private var email: String? {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.range(of: #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#, options: .regularExpression) != nil ? q : nil
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let matches = q.isEmpty ? [] : m.knownPeople.filter {
            !exclude.contains($0.userId) && ($0.name.localizedCaseInsensitiveContains(q) || ($0.email ?? "").localizedCaseInsensitiveContains(q))
        }
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(placeholder, text: $query)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .focused($focused)
                    .submitLabel(.search)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                        .accessibilityLabel("Clear")
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            if !q.isEmpty || focused {
                Divider()
                VStack(spacing: 0) {
                    ForEach(matches.prefix(6)) { k in
                        row(symbol: nil, name: k.name, seed: k.userId, sub: k.pending ? (k.email.map { "invited · \($0)" } ?? "invited") : nil) {
                            pick(PersonPick(userId: k.userId, name: k.name))
                        }
                    }
                    if let email, !matches.contains(where: { $0.email == email }) { emailRow(email) }
                    row(symbol: "person.crop.circle.badge.plus", name: "Pick from contacts", seed: nil, sub: nil) { contacts = true }
                }
            }
        }
        .glassSurface(in: .rect(cornerRadius: 20))
        .onChange(of: email) { _, _ in looked = nil; newName = "" }
        .task { if autofocus { try? await Task.sleep(for: .milliseconds(450)); focused = true } }
        .sheet(isPresented: $contacts) {
            ContactPicker { name, mail in
                contacts = false
                if let mail { query = mail; newName = name } else if !name.isEmpty { pick(PersonPick(name: name)) }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder private func emailRow(_ email: String) -> some View {
        if let l = looked, l.email == email {
            if l.onHeimat {
                row(symbol: nil, name: l.name ?? email, seed: email, sub: "on Splitlife · \(email)") {
                    pick(PersonPick(email: email, name: l.name ?? email))
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(email) isn't on Splitlife yet — they'll get an email with the expense.")
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                    HStack {
                        TextField("Their name", text: $newName).textFieldStyle(.roundedBorder)
                        Button("Add") {
                            let n = newName.trimmingCharacters(in: .whitespaces)
                            pick(PersonPick(email: email, name: n.isEmpty ? String(email.split(separator: "@")[0]) : n))
                        }
                        .glassProminentButton()
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
        } else {
            row(symbol: "envelope", name: looking ? "Looking up \(email)…" : "Add \(email)", seed: nil, sub: nil) {
                Task {
                    looking = true
                    if let r = await m.findPerson(email) { looked = (email, r.onHeimat, r.name) }
                    looking = false
                }
            }
            .disabled(looking)
        }
    }

    private func row(symbol: String?, name: String, seed: String?, sub: String?, _ action: @escaping () -> Void) -> some View {
        Button { Haptic.tap(); action() } label: {
            HStack(spacing: 12) {
                if let symbol {
                    Image(systemName: symbol).font(.system(size: 17, weight: .semibold)).foregroundStyle(.tint).frame(width: 32)
                } else {
                    AvatarView(name: name, seed: seed, size: 32)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.system(size: 15)).lineLimit(1)
                    if let sub { Text(sub).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .foregroundStyle(.primary)
    }
}

/// The system's contact picker: runs in its own process, so it needs no
/// permission and hands back only the contact chosen. Returns the name and,
/// when they have one, an email address.
struct ContactPicker: UIViewControllerRepresentable {
    let done: (_ name: String, _ email: String?) -> Void

    func makeUIViewController(context: Context) -> CNContactPickerViewController {
        let c = CNContactPickerViewController()
        c.delegate = context.coordinator
        c.displayedPropertyKeys = [CNContactEmailAddressesKey]
        return c
    }
    func updateUIViewController(_ vc: CNContactPickerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done) }

    final class Coordinator: NSObject, CNContactPickerDelegate {
        let done: (String, String?) -> Void
        init(_ done: @escaping (String, String?) -> Void) { self.done = done }
        func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) {
            let name = CNContactFormatter.string(from: contact, style: .fullName) ?? ""
            done(name, contact.emailAddresses.first.map { String($0.value) })
        }
        func contactPickerDidCancel(_ picker: CNContactPickerViewController) { done("", nil) }
    }
}

// MARK: - One person

/// Everything with one person: one figure, where it comes from, what you share.
struct PersonView: View {
    @Environment(AppModel.self) private var m
    let person: String

    var body: some View {
        let lines = m.lines(with: person)
        let totals = m.totals(lines)
        let main = totals.first
        let shared = m.sharedExpenses(with: person)
        let pending = !m.allMembers.contains { $0.userId == person && $0.claimedAt != nil }
        ScrollView {
            VStack(spacing: 14) {
                HeimatCard(radius: 28, padding: 18, tinted: true) {
                    VStack(spacing: 6) {
                        AvatarView(name: m.personName(person), seed: person, size: 56)
                        Text(m.personName(person)).font(.system(size: 20, weight: .bold))
                        if pending { Text("invited — not on Splitlife yet").font(.system(size: 12.5)).foregroundStyle(.secondary) }
                        if let main {
                            Text(main.minor > 0 ? "owes you" : "you owe").font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 4)
                            Text(Fmt.money(Money.toMajor(abs(main.minor), main.currency), main.currency))
                                .font(.system(size: 36, weight: .heavy)).monospacedDigit()
                                .foregroundStyle(main.minor > 0 ? Color.hGreen : Color.hRed)
                            ForEach(totals.dropFirst(), id: \.currency) { t in
                                Text((t.minor > 0 ? "and owes you " : "and you owe ") + Fmt.money(Money.toMajor(abs(t.minor), t.currency), t.currency))
                                    .font(.system(size: 13)).foregroundStyle(.secondary)
                            }
                        } else {
                            Text("All square").font(.system(size: 22, weight: .heavy)).padding(.top, 4)
                        }
                        HStack(spacing: 10) {
                            Button { m.sheet = .settlePerson(person) } label: {
                                Label("Settle up", systemImage: "arrow.left.arrow.right").frame(maxWidth: .infinity)
                            }
                            .glassProminentButton()
                            .disabled(main == nil)
                            if (main?.minor ?? 0) > 0 {
                                Button { Task { await m.remind(person) } } label: {
                                    Label("Remind", systemImage: "bell.badge").frame(maxWidth: .infinity)
                                }
                                .glassButton()
                            }
                        }
                        .controlSize(.large).lineLimit(1).minimumScaleFactor(0.75)
                        .padding(.top, 12)
                    }
                    .frame(maxWidth: .infinity)
                }

                // invited by name from contacts: nobody emails them, so the link is yours to send
                if pending, let link = m.allMembers.first(where: { $0.userId == person && $0.claimedAt == nil && $0.inviteEmail == nil })?.inviteLink,
                   let url = URL(string: link) {
                    ShareLink(item: url, message: Text("I added what we split on Splitlife — open this to see it and join: ")) {
                        Label("Send \(m.personName(person)) their link", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                    }
                    .glassProminentButton().controlSize(.large)
                }

                if !lines.isEmpty { whereFrom(lines) }

                Button { m.startAddExpense(prefill: ExpensePrefill(people: [PersonPick(userId: person, name: m.personName(person))])) } label: {
                    Label("Add an expense with \(m.personName(person))", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .glassButton().controlSize(.large)

                if !shared.isEmpty {
                    VStack(spacing: 0) {
                        SectionLabel("Shared expenses").padding(.bottom, 10)
                        HeimatCard(radius: 24, padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(shared.prefix(40).enumerated()), id: \.element.id) { i, e in
                                    Button { m.open(e) } label: {
                                        ExpenseRowView(e: e).padding(.horizontal, 14).padding(.vertical, 11)
                                    }
                                    .buttonStyle(PressStyle())
                                    if i < min(shared.count, 40) - 1 { RowDivider(inset: 64) }
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
        }
        .refreshable { await m.reload() }
        .navigationTitle(m.personName(person))
        .navigationBarTitleDisplayMode(.inline)
        .heimatScreen()
    }

    /// Non-group expenses as one line per currency; each group as its own
    private func whereFrom(_ lines: [AppModel.PlaceLine]) -> some View {
        var rows: [(key: String, place: String?, label: String, currency: String, minor: Int)] = []
        for l in lines {
            let circle = m.isCircle(l.place)
            let key = (circle ? "\u{0}friends" : l.place) + "\u{0}" + l.currency
            if let i = rows.firstIndex(where: { $0.key == key }) { rows[i].minor += l.minor }
            else { rows.append((key, circle ? nil : l.place, m.placeName(l.place), l.currency, l.minor)) }
        }
        rows = rows.filter { $0.minor != 0 }.sorted { abs($0.minor) != abs($1.minor) ? abs($0.minor) > abs($1.minor) : $0.key < $1.key }
        return VStack(spacing: 0) {
            SectionLabel("Where it comes from").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.key) { i, r in
                        Button {
                            if let p = r.place { m.switchFlat(p); m.groupsPath.append(.group(p)) } else { m.groupsPath.append(.nonGroup) }
                        } label: {
                            HStack {
                                Image(systemName: r.place == nil ? "person.2.fill" : "person.3.fill")
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).frame(width: 24)
                                Text(r.label).font(.system(size: 15)).lineLimit(1)
                                Spacer()
                                Text((r.minor > 0 ? "owes you " : "you owe ") + Fmt.money(Money.toMajor(abs(r.minor), r.currency), r.currency))
                                    .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                                    .foregroundStyle(r.minor > 0 ? Color.hGreen : Color.hRed)
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 13)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressStyle())
                        .foregroundStyle(.primary)
                        if i < rows.count - 1 { RowDivider(inset: 52) }
                    }
                }
            }
        }
    }
}

// MARK: - Settling up with one person

/// One payment with one person, spread over every group and your non-group
/// expenses so that each place's own balances stay right (Ledger.spread).
/// The preview shows exactly the payments that will be recorded.
struct PersonSettleForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let person: String
    @State private var currency = ""
    @State private var iPay = true
    @State private var amount = ""

    var body: some View {
        let lines = m.lines(with: person)
        let totals = m.totals(lines)
        let cur = currency.isEmpty ? (totals.first?.currency ?? m.hostCur) : currency
        let net = totals.first { $0.currency == cur }?.minor ?? 0     // positive: they owe you
        let pay = Money.parse(amount, cur) ?? 0
        let places = lines.filter { $0.currency == cur }.map { Ledger.SpreadPlace(place: $0.place, owed: iPay ? -$0.minor : $0.minor) }
        let fallback = m.pairCircle(with: person) ?? "\u{0}pair"
        let parts = Ledger.spread(pay, places, fallback: fallback)
        let name = m.personName(person)
        NavigationStack {
            Form {
                if totals.count > 1 {
                    Picker("Currency", selection: Binding(get: { cur }, set: { currency = $0; reset($0, totals) })) {
                        ForEach(totals, id: \.currency) { Text($0.currency).tag($0.currency) }
                    }
                }
                Section {
                    Picker("Who paid", selection: $iPay) {
                        Text("You paid \(name)").tag(true)
                        Text("\(name) paid you").tag(false)
                    }
                    .pickerStyle(.inline).labelsHidden()
                } footer: {
                    if net != 0 {
                        Text(net > 0 ? "\(name) owes you \(Fmt.money(Money.toMajor(net, cur), cur)) in all." : "You owe \(name) \(Fmt.money(Money.toMajor(-net, cur), cur)) in all.")
                    }
                }
                Section("Amount (\(cur))") {
                    TextField("0,00", text: $amount).keyboardType(.decimalPad).font(.title2.weight(.bold))
                }
                if pay > 0 && !parts.isEmpty {
                    Section {
                        // every circle is "Non-group expenses" to you: one line each way
                        ForEach(shown(parts, fallback: fallback), id: \.key) { r in
                            HStack {
                                Text(r.label)
                                Spacer()
                                Text((r.reverse ? "evened out " : "") + Fmt.money(Money.toMajor(r.minor, cur), cur))
                                    .monospacedDigit().foregroundStyle(r.reverse ? Color.secondary : Color.primary)
                            }
                        }
                    } header: { Text("Recorded as") } footer: {
                        let full = net != 0 && (iPay ? -net : net) > 0 && pay >= abs(net)
                        Text(full
                             ? "This squares you up with \(name) everywhere you share money" + (pay > abs(net) ? " — the extra is noted under non-group expenses." : ".")
                             : "Spread over the places you owe each other in, the largest first, so each one's own balances stay right.")
                    }
                }
            }
            .navigationTitle("Settle up with \(name)")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Record") {
                        let (c, p, me) = (cur, pay, iPay)
                        Task { await m.settle(with: person, currency: c, pay: p, iPay: me) }
                        dismiss()
                    }
                    .disabled(pay <= 0)
                }
            }
            .onAppear { reset(cur, totals) }
        }
    }

    private func shown(_ parts: [Ledger.SpreadPart], fallback: String) -> [(key: String, label: String, minor: Int, reverse: Bool)] {
        var out: [(key: String, label: String, minor: Int, reverse: Bool)] = []
        for p in parts {
            let circle = p.place == fallback || m.isCircle(p.place)
            let key = (circle ? "\u{0}friends" : p.place) + (p.reverse ? "<" : ">")
            if let i = out.firstIndex(where: { $0.key == key }) { out[i].minor += p.minor }
            else { out.append((key, circle ? "Non-group expenses" : m.placeName(p.place), p.minor, p.reverse)) }
        }
        return out.sorted { $0.minor != $1.minor ? $0.minor > $1.minor : $0.key < $1.key }
    }

    /// whoever owes pays, the whole amount, to start with
    private func reset(_ cur: String, _ totals: [(currency: String, minor: Int)]) {
        let net = totals.first { $0.currency == cur }?.minor ?? 0
        iPay = net <= 0
        amount = net == 0 ? "" : Money.input(abs(net), cur)
    }
}
