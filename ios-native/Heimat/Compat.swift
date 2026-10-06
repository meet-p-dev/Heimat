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

    /// Swiping sideways between the tabs. Its drag sits over every page's own
    /// scrolling, and iOS 18 changed how such gestures share a touch — it has
    /// stopped scroll views scrolling in some 18.x releases, and this pager has
    /// never run there. Scrolling matters more than swiping, so before iOS 26
    /// the tabs change by tapping the bar only.
    static var swipeTabs: Bool {
        if #available(iOS 26.0, *) { return !legacy }
        return false
    }
}

extension View {
    /// `.buttonStyle(.glass)`; a bordered capsule before iOS 26. Tint, role
    /// and control size come from the environment, so both honour them.
    @ViewBuilder func glassButton() -> some View {
        if #available(iOS 26.0, *), !Compat.legacy {
            buttonStyle(.glass)
        } else {
            buttonStyle(.bordered).buttonBorderShape(.capsule)
        }
    }

    /// `.buttonStyle(.glassProminent)`; a filled capsule in the tint before iOS 26.
    @ViewBuilder func glassProminentButton() -> some View {
        if #available(iOS 26.0, *), !Compat.legacy {
            buttonStyle(.glassProminent)
        } else {
            buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        }
    }

    /// `.glassEffect(.regular, in: shape)`, with `.tint` and `.interactive()`
    /// added only when asked for. Before iOS 26: a material in the same shape
    /// with a hairline edge, and the tint as a light wash over it.
    func glassSurface<S: Shape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(GlassSurface(shape: shape, tint: tint, interactive: interactive))
    }
}

private struct GlassSurface<S: Shape>: ViewModifier {
    let shape: S
    let tint: Color?
    let interactive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !Compat.legacy {
            content.glassEffect(glass, in: shape)
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
