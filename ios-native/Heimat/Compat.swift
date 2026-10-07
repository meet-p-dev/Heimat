import SwiftUI

/// Liquid Glass is iOS 26 only, and Splitlife runs back to iOS 18. Every glass
/// button and surface goes through these, never the iOS 26 API directly: on
/// iOS 26 they are exactly the system's glass, before it a bordered button or a
/// frosted material in the same shape, so the screens keep their layout.
enum Compat {
    #if DEBUG
    /// Launch with `-HeimatLegacyLook` to see the iOS 18 look on an iOS 26
    /// simulator. Never in a release build.
    static let legacy = ProcessInfo.processInfo.arguments.contains("-HeimatLegacyLook")
    #else
    static let legacy = false
    #endif

    /// The "receipt" symbol came with iOS 18.2; on 18.0 and 18.1 it would draw
    /// nothing, so those get a plain page instead.
    static var receiptSymbol: String {
        if #available(iOS 18.2, *) { return "receipt" }
        return "doc.text"
    }
}

extension View {
    /// `.buttonStyle(.glass)` in light mode; in dark mode a matte frosted capsule,
    /// since dark glass catches a bright reflection along its edge. A bordered
    /// capsule before iOS 26. Tint, role and control size come from the environment.
    func glassButton() -> some View { modifier(GlassButton()) }

    /// `.buttonStyle(.glassProminent)` in light mode; in dark mode a plain capsule
    /// filled with the tint, without glass's reflection. A filled capsule in the
    /// tint before iOS 26.
    func glassProminentButton() -> some View { modifier(GlassButton(prominent: true)) }

    /// `.glassEffect(.regular, in: shape)`, with `.tint` and `.interactive()`
    /// added only when asked for. Before iOS 26: a material in the same shape
    /// with a hairline edge, and the tint as a light wash over it.
    func glassSurface<S: InsettableShape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(GlassSurface(shape: shape, tint: tint, interactive: interactive))
    }
}

private struct GlassButton: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    var prominent = false

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !Compat.legacy {
            if scheme == .dark {
                content.buttonStyle(MatteButtonStyle(prominent: prominent))
            } else if prominent {
                content.buttonStyle(.glassProminent)
            } else {
                content.buttonStyle(.glass)
            }
        } else if prominent {
            content.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        } else {
            content.buttonStyle(.bordered).buttonBorderShape(.capsule)
        }
    }
}

/// Dark mode's stand-in for the glass buttons: the same capsule and sizes, on the
/// matte fill the cards have (or the tint, for the prominent one), with no reflection.
private struct MatteButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.controlSize) private var size
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let (h, v): (CGFloat, CGFloat) = switch size {
        case .mini: (10, 3)
        case .small: (12, 5)
        case .large: (20, 14)
        case .extraLarge: (22, 17)
        default: (14, 7)
        }
        configuration.label
            .foregroundStyle(prominent ? Color.white : configuration.role == .destructive ? Color.hRed : Color.primary)
            .padding(.horizontal, h).padding(.vertical, v)
            .background {
                if prominent { Capsule().fill(.tint) } else { MatteFill(shape: Capsule()) }
            }
            .contentShape(Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.6 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.smooth(duration: 0.15), value: configuration.isPressed)
    }
}

/// The dark mode card: frosted, so what scrolls behind it blurs away, with a faint
/// even edge instead of glass's bright highlight.
private struct MatteFill<S: InsettableShape>: View {
    let shape: S
    var tint: Color? = nil

    var body: some View {
        ZStack {
            shape.fill(.ultraThinMaterial)
            shape.fill(Color.white.opacity(0.05))
            if let tint { shape.fill(tint.opacity(0.14)) }
            shape.strokeBorder(Color.white.opacity(0.07), lineWidth: 0.75)
        }
    }
}

private struct GlassSurface<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let shape: S
    let tint: Color?
    let interactive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !Compat.legacy {
            if scheme == .dark {
                content.background { MatteFill(shape: shape, tint: tint) }
            } else {
                content.glassEffect(glass, in: shape)
            }
        } else {
            // all behind the content, the way glass sits behind it
            content.background {
                ZStack {
                    shape.fill(.regularMaterial)
                    if let tint { shape.fill(tint.opacity(0.12)) }
                    shape.stroke(Color.primary.opacity(0.08), lineWidth: 1)
                }
            }
        }
    }

    /// Built up from `.regular` so a plain call is the very same value as
    /// `.glassEffect(.regular, in:)`.
    @available(iOS 26.0, *)
    private var glass: Glass {
        var g = Glass.regular
        if let tint { g = g.tint(tint) }
        if interactive { g = g.interactive() }
        return g
    }
}
