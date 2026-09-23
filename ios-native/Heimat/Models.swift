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
    var isGroup: Bool { kind == "group" }
    var noun: String { isGroup ? "group" : "flat" }
    enum CodingKeys: String, CodingKey { case id, name, kind, joinCode = "join_code" }
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
    /// invited, but not on Heimat yet
    var isPending: Bool { inviteEmail != nil && claimedAt == nil }
    enum CodingKeys: String, CodingKey {
        case id, flatId = "flat_id", userId = "user_id", displayName = "display_name"
        case inviteEmail = "invite_email", claimedAt = "claimed_at"
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
    enum CodingKeys: String, CodingKey {
        case id, description, amount, currency, category
        case flatId = "flat_id", paidBy = "paid_by", splitAmong = "split_among", spentOn = "spent_on", createdBy = "created_by"
    }
    /// everyone the bill is split between; an empty split means the payer alone
    var parts: [String] { splitAmong.isEmpty ? [paidBy] : splitAmong }
    var share: Double { amount / Double(parts.count) }
}

struct Settlement: Codable, Identifiable, Hashable {
    let id: String
    let flatId: String
    var fromUser: String
    var toUser: String
    var amount: Double
    var settledOn: String
    enum CodingKeys: String, CodingKey { case id, amount, flatId = "flat_id", fromUser = "from_user", toUser = "to_user", settledOn = "settled_on" }
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
