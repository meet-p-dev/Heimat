import Foundation

/// The snapshot the widgets draw from.
///
/// Widgets run in their own process and are woken by the system at times we do
/// not choose, so they must never wait on the network. The app writes this
/// small summary into the shared App Group whenever its data changes, and the
/// widgets only ever read it — fast, offline, and with no auth to renew.
struct WidgetData: Codable, Equatable {
    var flatName: String = ""
    var inFlat = false
    var net: Double = 0            // + you are owed, − you owe
    var currency = "EUR"

    var daysUsed: Double = 0
    var dayBudget: Int = 120
    var weekHours: Double = 0
    var weekCap: Int = 20

    var recent: [Item] = []
    var updated = Date()

    struct Item: Codable, Equatable, Identifiable {
        var id: String
        var title: String
        var subtitle: String
        var amount: Double
    }

    static let suiteName = "group.app.heimat.mobile"
    private static let key = "widget-data"

    /// Placeholder for the widget gallery and for a first launch.
    static let sample = WidgetData(
        flatName: "Münchener Straße 67", inFlat: true, net: -203.5, currency: "EUR",
        daysUsed: 34, dayBudget: 120, weekHours: 12, weekCap: 20,
        recent: [
            .init(id: "1", title: "Kaufland", subtitle: "Kevin paid", amount: 25.21),
            .init(id: "2", title: "Potato + cello tape", subtitle: "Bhavin paid", amount: 3.39),
            .init(id: "3", title: "Splitwise", subtitle: "Bhavin paid", amount: 18.51),
        ]
    )

    static func read() -> WidgetData {
        guard let d = UserDefaults(suiteName: suiteName)?.data(forKey: key),
              let v = try? JSONDecoder().decode(WidgetData.self, from: d) else { return WidgetData() }
        return v
    }

    static func write(_ v: WidgetData) {
        guard let d = try? JSONEncoder().encode(v) else { return }
        UserDefaults(suiteName: suiteName)?.set(d, forKey: key)
    }
}

/// What a configurable widget can be pointed at.
enum WidgetMetric: String, Codable, CaseIterable {
    case balance, work
}
