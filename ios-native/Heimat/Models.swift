import Foundation
import SwiftUI
import UIKit

// MARK: - Shared flat data (Supabase). Column names follow the database.

struct Flat: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var joinCode: String
    /// "flat" for the place you live, "group" for people you split with
    var kind: String?
    /// engine v2: show the fewest payments rather than who owes whom, as a flat setting
    var simplifyDebts: Bool?
    var isGroup: Bool { kind == "group" }
    /// a hidden circle that holds expenses between friends, outside any group (see docs/friends-screens.md)
    var isDirect: Bool { kind == "direct" }
    var noun: String { "group" }
    enum CodingKeys: String, CodingKey { case id, name, kind, joinCode = "join_code", simplifyDebts = "simplify_debts" }
}

struct Member: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    /// A placeholder id until they sign up, and their real one afterwards. It
    /// is what expenses and settlements point at either way, so the history
    /// they arrive to is already theirs.
    let userId: String
    var displayName: String
    var inviteEmail: String?
    var claimedAt: String?
    var inviteToken: String?
    /// Written back by the invite function once it knows. Both nil means it
    /// hasn't reported yet; an error means the invite stands but no email got
    /// to them, and the link is the way round it.
    var inviteSentAt: String?
    var inviteError: String?
    /// Set when they leave or are removed. The row stays so that past
    /// expenses still resolve to a name and the books still balance.
    var leftAt: String?
    var hasLeft: Bool { leftAt != nil }
    /// invited, but not on Heimat yet (by email, or by a link shared with them)
    var isPending: Bool { claimedAt == nil && (inviteEmail != nil || inviteToken != nil) }
    var inviteLink: String? { inviteToken.map { "\(Secrets.publicURL)invite.html?t=\($0)" } }
    enum CodingKeys: String, CodingKey {
        case id, flatId = "flat_id", userId = "user_id", displayName = "display_name"
        case inviteEmail = "invite_email", claimedAt = "claimed_at", inviteToken = "invite_token"
        case inviteSentAt = "invite_sent_at", inviteError = "invite_error", leftAt = "left_at"
    }
}

struct Expense: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    var description: String?
    var amount: Double
    var currency: String
    var paidBy: String
    var splitAmong: [String]
    var category: String?
    var spentOn: String
    var createdBy: String?
    // engine v2 — absent on rows from before it, and on databases without its migration
    var splitType: String?
    var split: SplitData?
    /// minor units each person paid, when more than one did
    var payers: [String: Double]?
    /// minor units each person owes, worked out and stored by the database — the record
    var shares: [String: Double]?
    var recurringId: String?
    var deletedAt: String?
    enum CodingKeys: String, CodingKey {
        case id, description, amount, currency, category, split, payers, shares
        case flatId = "flat_id", paidBy = "paid_by", splitAmong = "split_among", spentOn = "spent_on", createdBy = "created_by"
        case splitType = "split_type", recurringId = "recurring_id", deletedAt = "deleted_at"
    }
    var storedShares: [String: Double]? { shares }
    /// everyone the bill is split between (each once); an empty split means the payer alone
    var parts: [String] { Ledger.participants(self) }
    /// has money on it: paid some of it, or has a share of it
    func isOn(_ uid: String) -> Bool { paidBy == uid || payers?[uid] != nil || parts.contains(uid) }
    /// what `uid` is charged for it: whole cents that add up to the total with
    /// everyone else's (10 € between three is 3,34 for one of them) — see Ledger.allocate
    func share(of uid: String?) -> Double { Ledger.share(self, of: uid) }
}

extension Expense: LedgerExpense {}

/// Someone picked for an expense outside any group: a person already known
/// (`userId`), or an email address, or — from contacts with no email — just a
/// name, who gets a link to share. The server turns these into a circle.
struct PersonPick: Hashable, Identifiable {
    var userId: String? = nil
    var email: String? = nil
    var name: String
    var id: String { userId ?? email.map { "mail:" + $0 } ?? "name:" + name }
    var json: [String: String] {
        if let userId { return ["user_id": userId] }
        if let email { return ["email": email, "name": name] }
        return ["name": name]
    }
}

/// Pages pushed inside the Groups tab.
enum GroupsRoute: Hashable {
    case group(String)
    case nonGroup
    case myBills
    case person(String)
}

struct Settlement: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    var fromUser: String
    var toUser: String
    var amount: Double
    var settledOn: String
    /// nil on rows from before currencies were recorded: the flat's own currency
    var currency: String?
    enum CodingKeys: String, CodingKey { case id, amount, currency, flatId = "flat_id", fromUser = "from_user", toUser = "to_user", settledOn = "settled_on" }
}

extension Settlement: LedgerSettlement {}

/// One line of a flat's history. Written by database triggers, never by the
/// app, so nothing that changes the money can quietly skip it.
struct Activity: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    let actor: String?
    let kind: String
    let subject: String?
    let amount: Double?
    let at: String
    enum CodingKeys: String, CodingKey { case id, actor, kind, subject, amount, at, flatId = "flat_id" }

    var symbol: String {
        switch kind {
        case "expense_added": "plus.circle.fill"
        case "expense_edited": "pencil.circle.fill"
        case "expense_deleted": "trash.circle.fill"
        case "settled": "arrow.left.arrow.right.circle.fill"
        case "settle_undone": "arrow.uturn.backward.circle.fill"
        case "joined": "person.crop.circle.badge.plus"
        case "invited": "envelope.circle.fill"
        case "left", "invite_withdrawn": "person.crop.circle.badge.minus"
        default: "circle.fill"
        }
    }
    var isGone: Bool { kind == "expense_deleted" || kind == "left" || kind == "invite_withdrawn" || kind == "settle_undone" }
}

struct ListItem: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    var title: String
    var category: String
    var addedBy: String?
    var bought: Bool
    var boughtBy: String?
    enum CodingKeys: String, CodingKey { case id, title, category, bought, flatId = "flat_id", addedBy = "added_by", boughtBy = "bought_by" }
}

struct FlatCategory: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    var key: String
    var label: String
    var icon: String
    var color: String
    enum CodingKeys: String, CodingKey { case id, key, label, icon, color, flatId = "flat_id" }
}

// MARK: - Personal data. Stays on the device, exactly like the web app.

struct Profile: Codable, Equatable {
    var name = ""
    var avatar: String?
    var homeCountry = "India", homeCur = "INR", homeIso = "in"
    var hostCountry = "Germany", hostCur = "EUR", hostIso = "de"
    var rate: Double = 1
    var rateAt: String?
    var onboarded = false
    /// the three questions (Life): who you share costs with, what you do — nil until answered
    var share: [String]?
    var doing: [String]?
    /// parts switched on or off by hand in Settings, over what the answers suggest
    var parts: [String: Bool]?
    /// tax details for the monthly estimate, and each employer's kind (TaxViews.swift)
    var tax: TaxDetails?
    var jobs: [String: JobSetting]?

    init() {}
    // tolerant: rows written by the web app may miss any field
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        name = c.v(.name, "")
        avatar = try? c.decodeIfPresent(String.self, forKey: .avatar)
        homeCountry = c.v(.homeCountry, "India"); homeCur = c.v(.homeCur, "INR"); homeIso = c.v(.homeIso, "in")
        hostCountry = c.v(.hostCountry, "Germany"); hostCur = c.v(.hostCur, "EUR"); hostIso = c.v(.hostIso, "de")
        rate = c.v(.rate, 1.0)
        rateAt = try? c.decodeIfPresent(String.self, forKey: .rateAt)
        onboarded = c.v(.onboarded, false)
        share = try? c.decodeIfPresent([String].self, forKey: .share)
        doing = try? c.decodeIfPresent([String].self, forKey: .doing)
        parts = try? c.decodeIfPresent([String: Bool].self, forKey: .parts)
        tax = try? c.decodeIfPresent(TaxDetails.self, forKey: .tax)
        jobs = try? c.decodeIfPresent([String: JobSetting].self, forKey: .jobs)
    }

    /// whether a part of the app is shown: a hand-made choice first, else what the answers suggest
    func on(_ part: Life.Part) -> Bool { parts?[part.rawValue] ?? Life.suggested(part, share: share, doing: doing) }
}

/// Who someone is, in three questions, and the parts of the app that follows from it
/// (docs: the same rules as src/lib/life.ts). Hiding a part never deletes anything.
enum Life {
    enum Share: String, CaseIterable, Identifiable {
        case flatmates, partner, family, friends
        var id: Self { self }
        var label: String { switch self { case .flatmates: "Flatmates"; case .partner: "Partner"; case .family: "Family & kids"; case .friends: "Friends" } }
        var symbol: String { switch self { case .flatmates: "house.fill"; case .partner: "heart.fill"; case .family: "figure.2.and.child.holdinghands"; case .friends: "person.2.fill" } }
    }
    enum Doing: String, CaseIterable, Identifiable {
        case study, shifts, salaried, looking
        var id: Self { self }
        var label: String { switch self { case .study: "Studying"; case .shifts: "Job with shifts or hours"; case .salaried: "Salaried job"; case .looking: "Looking for work" } }
        var symbol: String { switch self { case .study: "graduationcap.fill"; case .shifts: "clock.fill"; case .salaried: "briefcase.fill"; case .looking: "magnifyingglass" } }
    }
    enum Part: String, CaseIterable, Identifiable {
        case groups, bills, chores, list, work, limit
        var id: Self { self }
        var label: String {
            switch self {
            case .groups: "Shared expenses"; case .bills: "Bills"; case .chores: "Chores rota"
            case .list: "Shopping list"; case .work: "Shifts & pay"; case .limit: "Work limit"
            }
        }
        var sub: String {
            switch self {
            case .groups: "Groups, friends and settling up"
            case .bills: "Rent, phone, insurance — reminders and ticks"
            case .chores: "Whose turn it is, and points"
            case .list: "One list for the household"
            case .work: "Log shifts and see your pay"
            case .limit: "Stay under a student visa's hours"
            }
        }
        var symbol: String {
            switch self {
            case .groups: "person.3.fill"; case .bills: "doc.text.fill"; case .chores: "sparkles"
            case .list: "cart.fill"; case .work: "clock.fill"; case .limit: "gauge.with.needle.fill"
            }
        }
    }

    /// Before the questions were asked (everyone from before them) everything stays on.
    static func suggested(_ part: Part, share: [String]?, doing: [String]?) -> Bool {
        guard let share, let doing else { return true }
        let home = share.contains { ["flatmates", "partner", "family"].contains($0) }
        switch part {
        case .groups: return !share.isEmpty
        case .bills: return true
        case .chores, .list: return home
        case .work: return doing.contains("shifts")
        case .limit: return doing.contains("study") && doing.contains("shifts")
        }
    }
}

struct Shift: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var date: String = Fmt.today()
    var employer = ""
    var start = ""
    var end = ""
    var breakMin: Double = 0
    var paidBreak = false
    var wage: Double = 0
    var hours: Double?
    var pay: Double?

    init() {}
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = c.v(.id, UUID().uuidString); date = c.v(.date, Fmt.today()); employer = c.v(.employer, "")
        start = c.v(.start, ""); end = c.v(.end, ""); breakMin = c.v(.breakMin, 0.0); paidBreak = c.v(.paidBreak, false)
        wage = c.v(.wage, 0.0)
        hours = try? c.decodeIfPresent(Double.self, forKey: .hours)
        pay = try? c.decodeIfPresent(Double.self, forKey: .pay)
    }
}

enum ThemeMode: String, Codable, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { self == .system ? "Automatic" : rawValue.capitalized }
    var scheme: ColorScheme? { self == .system ? nil : self == .dark ? .dark : .light }
}

struct Prefs: Codable, Equatable {
    var theme: ThemeMode = .system
    var haptics = true
    var autoRate = true
    var weekCap = 20
    var yearDays = 120

    init() {}
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        theme = c.v(.theme, .system); haptics = c.v(.haptics, true); autoRate = c.v(.autoRate, true)
        weekCap = c.v(.weekCap, 20); yearDays = c.v(.yearDays, 120)
    }
}

extension KeyedDecodingContainer {
    /// decode if present and well-formed, otherwise fall back
    func v<T: Decodable>(_ k: Key, _ fallback: T) -> T { ((try? decodeIfPresent(T.self, forKey: k)) ?? nil) ?? fallback }
}

// MARK: - Static data

struct Country: Hashable, Identifiable {
    let name: String, cur: String, iso: String
    var id: String { name }
    var flag: String {
        guard iso.count == 2 else { return "🌍" }
        return iso.uppercased().unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value) }.map(String.init).joined()
    }
}

enum Countries {
    static let home: [Country] = [
        ("India", "INR", "in"), ("China", "CNY", "cn"), ("Pakistan", "PKR", "pk"), ("Nigeria", "NGN", "ng"), ("Turkey", "TRY", "tr"),
        ("Iran", "IRR", "ir"), ("Bangladesh", "BDT", "bd"), ("Indonesia", "IDR", "id"), ("Egypt", "EGP", "eg"), ("Brazil", "BRL", "br"),
        ("Vietnam", "VND", "vn"), ("Mexico", "MXN", "mx"), ("Russia", "RUB", "ru"), ("Ukraine", "UAH", "ua"), ("Morocco", "MAD", "ma"),
        ("Ghana", "GHS", "gh"), ("Kenya", "KES", "ke"), ("Philippines", "PHP", "ph"), ("Nepal", "NPR", "np"), ("Sri Lanka", "LKR", "lk"),
        ("Colombia", "COP", "co"), ("Argentina", "ARS", "ar"), ("South Africa", "ZAR", "za"), ("Thailand", "THB", "th"), ("Malaysia", "MYR", "my"),
        ("Saudi Arabia", "SAR", "sa"), ("United States", "USD", "us"), ("United Kingdom", "GBP", "gb"), ("Uzbekistan", "UZS", "uz"),
        ("Georgia", "GEL", "ge"), ("Other / not listed", "USD", ""),
    ].map { Country(name: $0.0, cur: $0.1, iso: $0.2) }

    static let host: [Country] = [
        ("Germany", "EUR", "de"), ("Austria", "EUR", "at"), ("Netherlands", "EUR", "nl"), ("France", "EUR", "fr"), ("Italy", "EUR", "it"),
        ("Spain", "EUR", "es"), ("United Kingdom", "GBP", "gb"), ("United States", "USD", "us"), ("Canada", "CAD", "ca"),
        ("Switzerland", "CHF", "ch"), ("Sweden", "SEK", "se"), ("Australia", "AUD", "au"), ("Poland", "PLN", "pl"), ("Ireland", "EUR", "ie"),
    ].map { Country(name: $0.0, cur: $0.1, iso: $0.2) }
}

/// A category as shown: built-in or one the flat added.
struct Cat: Identifiable, Hashable {
    let id: String, label: String, symbol: String, color: Color
    var custom = false
}

enum Cats {
    static let builtIn: [Cat] = [
        Cat(id: "rent", label: "Rent", symbol: "house.fill", color: Color(hex: "#3ddc97")),
        Cat(id: "groceries", label: "Groceries", symbol: "cart.fill", color: Color(hex: "#c8a24a")),
        Cat(id: "utilities", label: "Utilities", symbol: "bolt.fill", color: Color(hex: "#5ec7a8")),
        Cat(id: "internet", label: "Internet", symbol: "wifi", color: Color(hex: "#6ba8e0")),
        Cat(id: "eatout", label: "Eating out", symbol: "fork.knife", color: Color(hex: "#fb7185")),
        Cat(id: "transport", label: "Transport", symbol: "tram.fill", color: Color(hex: "#8aa0b4")),
        Cat(id: "household", label: "Household", symbol: "sparkles", color: Color(hex: "#b89ce0")),
        Cat(id: "other", label: "Other", symbol: "shippingbox.fill", color: Color(hex: "#7e8e87")),
    ]
    /// the web app stores custom icons by these names; each maps to an SF Symbol
    static let icons: [(key: String, symbol: String)] = [
        ("tag", "tag.fill"), ("bag", "bag.fill"), ("cart", "cart.fill"), ("shirt", "tshirt.fill"), ("pill", "pills.fill"),
        ("gym", "dumbbell.fill"), ("gift", "gift.fill"), ("pet", "pawprint.fill"), ("baby", "stroller.fill"), ("tools", "wrench.and.screwdriver.fill"),
        ("clean", "sparkles"), ("coffee", "cup.and.saucer.fill"), ("beer", "mug.fill"), ("smoke", "smoke.fill"), ("film", "film.fill"),
        ("plane", "airplane"), ("book", "book.fill"), ("trash", "trash.fill"),
    ]
    static let colors = ["#3ddc97", "#c8a24a", "#5ec7a8", "#6ba8e0", "#fb7185", "#8aa0b4", "#b89ce0", "#f5b84e", "#14a978", "#e08a6b"]

    static func merged(_ custom: [FlatCategory]) -> [Cat] {
        builtIn + custom.map { c in
            Cat(id: c.key, label: c.label, symbol: icons.first { $0.key == c.icon }?.symbol ?? "tag.fill", color: Color(hex: c.color), custom: true)
        }
    }
    static func of(_ cats: [Cat], _ id: String?) -> Cat { cats.first { $0.id == id } ?? builtIn.last! }

    static func slug(_ label: String) -> String {
        let s = label.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        return String(s.trimmingCharacters(in: CharacterSet(charactersIn: "-")).prefix(32))
    }
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var n: UInt64 = 0
        Scanner(string: h).scanHexInt64(&n)
        self.init(red: Double((n >> 16) & 0xff) / 255, green: Double((n >> 8) & 0xff) / 255, blue: Double(n & 0xff) / 255)
    }
    static let work = Color(hex: "#16c784")
    static let gold = Color(hex: "#c8a24a")

    /// One colour per appearance, the way the web tokens define them.
    static func adaptive(dark: String, light: String) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
    }
    /// Heimat's semantic colours — softer than the system's, and the same
    /// values the web app uses, so the two builds read as one product.
    static let hRed = adaptive(dark: "#ff7a8a", light: "#c8362e")
    static let hGreen = adaptive(dark: "#3ddc97", light: "#08864f")
    static let hAmber = adaptive(dark: "#f5b84e", light: "#9a6a12")
}

enum AvatarColors {
    static let all = ["#16a974", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#ef4444", "#14b8a6", "#64748b"]
    static func forSeed(_ seed: String) -> String {
        var h: UInt32 = 0
        for u in seed.unicodeScalars { h = h &* 31 &+ u.value }
        return all[Int(h % UInt32(all.count))]
    }
}

// MARK: - Bills

/// Something paid again and again (supabase/migrations/20261002000000_bills_and_chores.sql):
/// a group's (flatId) or your own (ownerId). Ticking a due date only says "paid".
struct Bill: Codable, Identifiable, Hashable {
    let id: String
    var flatId: String?
    var ownerId: String?
    var name: String
    var amount: Double?
    var currency: String
    var category: String
    var cadence: String
    var anchorOn: String
    var payer: String?
    var contractEndsOn: String?
    var noticeAmount: Int?
    var noticeUnit: String?

    enum CodingKeys: String, CodingKey {
        case id, name, amount, currency, category, cadence, payer
        case flatId = "flat_id", ownerId = "owner_id", anchorOn = "anchor_on"
        case contractEndsOn = "contract_ends_on", noticeAmount = "notice_amount", noticeUnit = "notice_unit"
    }

    static let cadences: [(String, String)] = [("weekly", "Every week"), ("biweekly", "Every 2 weeks"), ("monthly", "Every month"), ("quarterly", "Every 3 months"), ("yearly", "Every year")]
    var cadenceLabel: String { Self.cadences.first { $0.0 == cadence }?.1 ?? cadence }
}

/// Where a bill stands today: the due date to act on (the oldest unpaid one, or the
/// next when all are paid) and the latest tick.
struct BillStatus: Codable, Hashable {
    let billId: String
    let dueOn: String
    let state: String          // upcoming · due · overdue · paid
    let paidOn: String?
    let paidBy: String?
    let cancelBy: String?

    enum CodingKeys: String, CodingKey {
        case state
        case billId = "bill_id", dueOn = "due_on", paidOn = "paid_on", paidBy = "paid_by", cancelBy = "cancel_by"
    }
}

// MARK: - Chores

/// A rota in a group (docs/chores-screens.md): each period the chore is one person's.
struct Chore: Codable, Identifiable, Hashable {
    let id: String
    var flatId: String
    var name: String
    var cadence: String
    var anchorOn: String
    var points: Int
    var rota: [String]

    enum CodingKeys: String, CodingKey {
        case id, name, cadence, points, rota
        case flatId = "flat_id", anchorOn = "anchor_on"
    }
    static let sizes: [(Int, String)] = [(1, "Small"), (2, "Medium"), (3, "Big")]

    /// How often: every N days, weeks or months (1–99), stored as one word — the old names
    /// for 1 week / 2 weeks / 1 month, "<N><d|w|m>" for the rest. Same as src/lib/chores.ts.
    static func parse(_ c: String) -> (n: Int, unit: String) {
        switch c {
        case "weekly": return (1, "w")
        case "biweekly": return (2, "w")
        case "monthly": return (1, "m")
        default:
            guard let u = c.last, "dwm".contains(u), let n = Int(c.dropLast()), (1...99).contains(n), !c.hasPrefix("0") else { return (1, "w") }
            return (n, String(u))
        }
    }
    static func cadence(_ n: Int, _ unit: String) -> String {
        let k = min(99, max(1, n))
        if unit == "w" && k == 1 { return "weekly" }
        if unit == "w" && k == 2 { return "biweekly" }
        if unit == "m" && k == 1 { return "monthly" }
        return "\(k)\(unit)"
    }
    static func label(_ c: String) -> String {
        let (n, u) = parse(c)
        let w = ["d": ("day", "days"), "w": ("week", "weeks"), "m": ("month", "months")][u] ?? ("week", "weeks")
        return n == 1 ? "Every \(w.0)" : "Every \(n) \(w.1)"
    }
    /// the ones most people want, one tap each
    static let presets = ["1d", "2d", "weekly", "biweekly", "monthly"]
}

/// One period of a chore: whose it is, and whether it was done (and the points it earned).
struct ChoreTurn: Codable, Hashable {
    let choreId: String
    let n: Int
    let flatId: String
    let startsOn: String
    let endsOn: String
    let assignee: String?
    let state: String          // open · done · missed
    let doneBy: String?
    let doneAt: String?
    let points: Int?

    enum CodingKeys: String, CodingKey {
        case n, assignee, state, points
        case choreId = "chore_id", flatId = "flat_id", startsOn = "starts_on", endsOn = "ends_on", doneBy = "done_by", doneAt = "done_at"
    }
}

/// "Can you take my turn?" — waiting for an answer.
struct ChoreSwap: Codable, Identifiable, Hashable {
    let id: String
    let choreId: String
    let n: Int
    let flatId: String
    let fromUser: String
    let toUser: String

    enum CodingKeys: String, CodingKey {
        case id, n
        case choreId = "chore_id", flatId = "flat_id", fromUser = "from_user", toUser = "to_user"
    }
}

/// What app_update answers when a newer build is out: its number, and the TestFlight
/// link that gets it (the TestFlight app itself, itms-beta://, when there is no public link).
struct AppUpdate: Decodable, Equatable {
    let build: Int
    let url: String
}
