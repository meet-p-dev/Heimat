import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Configuration

/// Lets each placed widget be pointed at a different number, which is as close
/// to "build your own" as WidgetKit allows: the layout is ours, the choice is
/// the user's, and they can place several with different settings.
enum MetricChoice: String, AppEnum {
    case balance, work

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "What to show" }
    static var caseDisplayRepresentations: [MetricChoice: DisplayRepresentation] = [
        .balance: "Flat balance",
        .work: "Work limit",
    ]
}

struct HeimatWidgetConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Heimat widget"
    static var description = IntentDescription("Pick what this widget shows.")

    @Parameter(title: "Show", default: .balance)
    var metric: MetricChoice
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let data: WidgetData
    let config: HeimatWidgetConfig
}

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, data: .sample, config: HeimatWidgetConfig())
    }

    func snapshot(for config: HeimatWidgetConfig, in context: Context) async -> Entry {
        // the gallery preview has no real data behind it yet
        Entry(date: .now, data: context.isPreview ? .sample : WidgetData.read(), config: config)
    }

    func timeline(for config: HeimatWidgetConfig, in context: Context) async -> Timeline<Entry> {
        // The app refreshes us when anything changes, so this is only a floor
        // to keep a long-untouched widget from going stale.
        Timeline(entries: [Entry(date: .now, data: WidgetData.read(), config: config)],
                 policy: .after(.now.addingTimeInterval(60 * 60)))
    }
}

// MARK: - Shared pieces

private func money(_ v: Double, _ code: String) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = code
    f.maximumFractionDigits = 2
    return f.string(from: NSNumber(value: v)) ?? String(format: "%.2f", v)
}

private func num(_ v: Double, _ digits: Int = 1) -> String {
    String(format: "%.\(digits)f", v)
}

private let accent = Color(red: 0.184, green: 0.827, blue: 0.604)
private let bad = Color(red: 1, green: 0.478, blue: 0.541)

/// The ring the app uses, at widget scale.
private struct MiniRing: View {
    let pct: Double
    var color: Color = accent
    var line: CGFloat = 6

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.2), lineWidth: line)
            Circle()
                .trim(from: 0, to: min(max(pct, 0), 1))
                .stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

private struct Heading: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .bold)).kerning(0.5)
            .foregroundStyle(.secondary)
    }
}

// MARK: - The metrics

private struct BalanceView: View {
    let d: WidgetData
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Heading(text: d.inFlat ? d.flatName : "Heimat")
            if d.inFlat {
                Text((d.net < 0 ? "−" : d.net > 0 ? "+" : "") + money(abs(d.net), d.currency))
                    .font(.system(size: 24, weight: .heavy)).minimumScaleFactor(0.5).lineLimit(1)
                    .foregroundStyle(d.net > 0 ? accent : d.net < 0 ? bad : .primary)
                Text(d.net > 0 ? "you are owed" : d.net < 0 ? "you owe" : "all settled up")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                Text("No flat yet").font(.system(size: 17, weight: .bold))
                Text("Create or join one").font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }
}

private struct WorkView: View {
    let d: WidgetData
    private var over: Bool { d.weekHours > Double(d.weekCap) }
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                MiniRing(pct: d.daysUsed / Double(max(d.dayBudget, 1)), color: over ? bad : accent)
                Text(num(d.daysUsed, d.daysUsed.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1))
                    .font(.system(size: 13, weight: .heavy))
            }
            .frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 2) {
                Heading(text: "Work limit")
                Text("\(num(d.weekHours)) h").font(.system(size: 16, weight: .bold))
                Text("of \(d.weekCap) h this week")
                    .font(.system(size: 10)).foregroundStyle(over ? bad : .secondary)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Sizes

struct HeimatWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        switch family {
        case .accessoryCircular:
            accessory
        case .systemSmall:
            small
        case .systemLarge:
            large
        default:
            medium
        }
    }

    @ViewBuilder private var chosen: some View {
        switch entry.config.metric {
        case .balance: BalanceView(d: entry.data)
        case .work: WorkView(d: entry.data)
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            chosen
            Spacer(minLength: 4)
            addButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var medium: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                BalanceView(d: entry.data)
                addButton
            }
            Divider()
            WorkView(d: entry.data)
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            BalanceView(d: entry.data)
            WorkView(d: entry.data)
            if !entry.data.recent.isEmpty {
                Divider()
                Heading(text: "Recent")
                ForEach(entry.data.recent.prefix(3)) { e in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(e.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                            Text(e.subtitle).font(.system(size: 10)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(money(e.amount, entry.data.currency))
                            .font(.system(size: 12, weight: .semibold))
                    }
                }
            }
            Spacer(minLength: 0)
            addButton
        }
    }

    /// Lock Screen: work days used, the one number worth a glance there.
    private var accessory: some View {
        ZStack {
            MiniRing(pct: entry.data.daysUsed / Double(max(entry.data.dayBudget, 1)),
                     color: .primary, line: 5)
            Text(num(entry.data.daysUsed, 0))
                .font(.system(size: 15, weight: .heavy))
        }
    }

    /// Opens Heimat straight on the new-expense sheet.
    private var addButton: some View {
        Link(destination: URL(string: "heimat://add-expense")!) {
            HStack(spacing: 5) {
                Image(systemName: "plus")
                Text("Add expense")
            }
            .font(.system(size: 12, weight: .bold))
            .padding(.horizontal, 11).padding(.vertical, 7)
            .frame(maxWidth: .infinity)
            .background(accent.opacity(0.22), in: Capsule())
            .foregroundStyle(accent)
        }
    }
}

// MARK: - Entry points

struct HeimatWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "HeimatWidget", intent: HeimatWidgetConfig.self, provider: Provider()) { entry in
            HeimatWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Heimat")
        .description("Your flat balance or work limit — and a way straight into a new expense.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular])
    }
}

@main
struct HeimatWidgetBundle: WidgetBundle {
    var body: some Widget { HeimatWidget() }
}
