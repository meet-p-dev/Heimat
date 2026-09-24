import SwiftUI
import UIKit

struct AvatarView: View {
    let name: String
    var color: String? = nil
    var seed: String? = nil
    var size: CGFloat = 40

    var body: some View {
        let hex = color ?? AvatarColors.forSeed(seed ?? name)
        Text(Fmt.initials(name.isEmpty ? "?" : name))
            .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(hex: hex).gradient, in: Circle())
            .accessibilityHidden(true)
    }
}

struct CatIcon: View {
    let cat: Cat
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: cat.symbol)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(cat.color)
            .frame(width: size, height: size)
            .background(cat.color.opacity(0.16), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

/// the coloured square icons of iOS Settings
struct SettingIcon: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 29, height: 29)
            .background(color.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct Ring: View {
    let pct: Double
    var color: Color = .accentColor
    var line: CGFloat = 10

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: line)
            Circle()
                .trim(from: 0, to: min(max(pct, 0), 1))
                .stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: color.opacity(0.45), radius: 5)
                .animation(.smooth, value: pct)
        }
    }
}

struct Pill: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
}

/// One shared expense, with what it means for you right under the amount.
struct ExpenseRowView: View {
    @Environment(AppModel.self) private var m
    let e: Expense

    var body: some View {
        let c = Cats.of(m.cats, e.category)
        HStack(spacing: 12) {
            CatIcon(cat: c)
            VStack(alignment: .leading, spacing: 2) {
                Text((e.description ?? "").isEmpty ? c.label : e.description!)
                    .font(.body.weight(.semibold)).lineLimit(1)
                Text("\(m.nameOf(e.paidBy)) paid · \(Fmt.relDay(e.spentOn))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(m.fH(e.amount)).font(.body.weight(.semibold)).monospacedDigit()
                let n = note
                Text(n.0).font(.caption2.weight(.semibold)).foregroundStyle(n.1)
            }
        }
        .contentShape(Rectangle())
    }

    private var note: (String, Color) {
        guard let uid = m.uid else { return ("", .secondary) }
        let shares = Ledger.shares(e)
        if e.paidBy == uid {
            // what everyone else owes you for it, to the cent
            let lent = shares.reduce(0) { $0 + ($1.uid == uid ? 0 : $1.minor) }
            return lent > 0 ? ("you lent \(Fmt.money(Money.toMajor(lent, e.currency), e.currency))", .hGreen) : ("just you", .secondary)
        }
        guard let mine = shares.first(where: { $0.uid == uid }) else { return ("not involved", .secondary) }
        return ("you owe \(Fmt.money(Money.toMajor(mine.minor, e.currency), e.currency))", .hRed)
    }
}

struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 18).padding(.vertical, 11)
            .glassEffect(.regular, in: .capsule)
            .padding(.horizontal, 24).padding(.top, 6)
    }
}

enum Haptic {
    static var on = true
    static func tap() { if on { UIImpactFeedbackGenerator(style: .light).impactOccurred() } }
    static func success() { if on { UINotificationFeedbackGenerator().notificationOccurred(.success) } }
}

/// a button that runs async work and shows a spinner meanwhile
struct AsyncButton<Label: View>: View {
    var role: ButtonRole? = nil
    let action: () async -> Void
    @ViewBuilder let label: () -> Label
    @State private var running = false

    var body: some View {
        Button(role: role) {
            guard !running else { return }
            running = true
            Task { await action(); running = false }
        } label: {
            if running { ProgressView() } else { label() }
        }
        .disabled(running)
    }
}

/// The tile colours Heimat uses for its icon chips, matching `TINT` on the web.
enum Tint {
    static let green = Color(hex: "#16a974")
    static let blue = Color(hex: "#3b82f6")
    static let pink = Color(hex: "#ec4899")
    static let orange = Color(hex: "#f59e0b")
    static let teal = Color(hex: "#14b8a6")
    static let indigo = Color(hex: "#6366f1")
    static let gray = Color(hex: "#7c8a85")
}

/// The press-in that every tappable surface has on the web.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.62), value: configuration.isPressed)
    }
}

/// A card floating on the ambient wash. Unlike the web's blur-only imitation
/// this is the system's Liquid Glass, so it refracts what scrolls behind it.
/// `tinted` adds the accent wash the hero card carries.
struct HeimatCard<Content: View>: View {
    var radius: CGFloat = 24
    var padding: CGFloat = 16
    var tinted = false
    var action: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let card = content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background {
                if tinted {
                    shape.fill(LinearGradient(colors: [Color.accentColor.opacity(0.18), .clear],
                                              startPoint: .topLeading, endPoint: .bottom))
                }
            }
            .glassEffect(.regular, in: shape)
        if let action {
            Button { Haptic.tap(); action() } label: { card }.buttonStyle(PressStyle())
        } else {
            card
        }
    }
}

/// One of the square shortcuts under the balance.
struct QuickAction: View {
    let symbol: String
    let tint: Color
    let label: String
    var badge: Int = 0
    let action: () -> Void

    var body: some View {
        Button { Haptic.tap(); action() } label: {
            VStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(tint.gradient, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text(badge > 99 ? "99+" : "\(badge)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(.red, in: Capsule())
                                .offset(x: 8, y: -6)
                        }
                    }
                Text(label).font(.system(size: 12.5, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .glassEffect(.regular, in: .rect(cornerRadius: 22))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(badge > 0 ? "\(label), \(badge) to buy" : label)
    }
}

/// The small grey heading above a group, with an optional action on the right.
struct SectionLabel<Trailing: View>: View {
    let text: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack {
            Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(.tertiary)
            Spacer()
            trailing()
        }
        .padding(.horizontal, 6)
        .padding(.top, 8)
    }
}

extension SectionLabel where Trailing == EmptyView {
    init(_ text: String) { self.init(text: text) { EmptyView() } }
}

/// Green while you are inside the work allowance, amber near it, red past it.
func tone(_ t: Calc.WorkStats.Tone) -> Color { t == .over ? .hRed : t == .close ? .hAmber : .work }

/// A pill: switching between flats, or adding one.
struct Chip: View {
    let text: String
    var symbol: String? = nil
    var on = false
    var dashed = false
    let action: () -> Void

    var body: some View {
        Button { Haptic.tap(); action() } label: {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 12, weight: .bold)) }
                Text(text).font(.system(size: 13.5, weight: .semibold))
            }
            .padding(.horizontal, 13).padding(.vertical, 8)
            .foregroundStyle(on ? Color.accentColor : Color.secondary)
            .background {
                ZStack {
                    Capsule().fill(on ? Color.accentColor.opacity(0.16) : Color.clear)
                    Capsule().strokeBorder(
                        on ? Color.accentColor.opacity(0.45) : Color.secondary.opacity(0.3),
                        style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : [])
                    )
                }
            }
        }
        .buttonStyle(PressStyle())
    }
}

/// A row in a grouped card: tinted icon, label, optional subtitle and value.
struct HeimatRow: View {
    let symbol: String
    let tint: Color
    let label: String
    var sub: String? = nil
    var value: String? = nil
    var chevron = true
    let action: () -> Void

    var body: some View {
        Button { Haptic.tap(); action() } label: {
            HStack(spacing: 13) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(tint.gradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.system(size: 16))
                    if let sub { Text(sub).font(.system(size: 12.5)).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 8)
                if let value {
                    Text(value).font(.system(size: 15)).foregroundStyle(.secondary).monospacedDigit()
                }
                if chevron {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            .frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .foregroundStyle(.primary)
    }
}

/// The hairline between rows of a grouped card, inset past the icon.
struct RowDivider: View {
    var inset: CGFloat = 61
    var body: some View { Divider().padding(.leading, inset) }
}

/// Heimat's own header, in place of the system navigation bar: the kicker and
/// title on the left, settings and profile on the same row — the arrangement
/// the app has on the web. Pinned with `safeAreaInset`, so content scrolls
/// under it and the fade keeps the text legible while it does.
struct HeimatHeader: View {
    @Environment(AppModel.self) private var m
    var kicker: String? = nil
    let title: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                if let kicker {
                    Text(kicker)
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                Text(title)
                    .font(.system(size: 30, weight: .heavy))
                    .lineLimit(1).minimumScaleFactor(0.65)
            }
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                Button { Haptic.tap(); m.sheet = .settings } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 38, height: 38)
                }
                .accessibilityLabel("Settings")
                Button { Haptic.tap(); m.sheet = .profile } label: {
                    AvatarView(name: m.profile.name, color: m.profile.avatar, seed: m.uid, size: 34)
                }
                .accessibilityLabel("Your profile")
            }
            .buttonStyle(PressStyle())
            .foregroundStyle(.primary)
            .padding(.horizontal, 5).padding(.vertical, 4)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
                .ignoresSafeArea(edges: .top)
        }
    }
}
