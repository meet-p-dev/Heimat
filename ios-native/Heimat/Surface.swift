import SwiftUI
import UIKit

/// Heimat's ambient background — the wash the app has always sat on: a deep
/// base, four wide low-opacity radials in one hue family, a vignette to hold
/// the edges, and a grain tile. The grain is what keeps gradients this soft
/// from banding on an OLED panel.
struct HeimatBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        ZStack {
            (dark ? Color(hex: "#070b0a") : Color(hex: "#eef2f0"))

            Wash(color: Color(hex: dark ? "#1ea074" : "#229670"), opacity: dark ? 0.18 : 0.13, at: .init(x: 0.06, y: 0.02), w: 1.6, h: 0.52)
            Wash(color: Color(hex: dark ? "#2860a0" : "#4a7cb4"), opacity: dark ? 0.14 : 0.10, at: .init(x: 1.00, y: 0.12), w: 1.5, h: 0.48)
            Wash(color: Color(hex: dark ? "#be9e60" : "#c6a056"), opacity: dark ? 0.08 : 0.09, at: .init(x: 0.84, y: 1.06), w: 1.8, h: 0.58)
            Wash(color: Color(hex: dark ? "#167666" : "#349686"), opacity: dark ? 0.13 : 0.10, at: .init(x: -0.10, y: 0.70), w: 1.35, h: 0.46)

            // a light lift at the top, then the vignette over everything
            LinearGradient(colors: [dark ? Color(hex: "#beffe6").opacity(0.035) : .white.opacity(0.5), .clear],
                           startPoint: .top, endPoint: .center)
            RadialGradient(colors: [.clear, (dark ? Color.black : Color(hex: "#1a3a2e")).opacity(dark ? 0.45 : 0.11)],
                           center: .init(x: 0.5, y: 0.38), startRadius: 120, endRadius: 620)

            Image(uiImage: Self.grain)
                .resizable(resizingMode: .tile)
                .opacity(dark ? 0.045 : 0.03)
        }
        .ignoresSafeArea()
        // decoration only — never take a touch away from the controls above
        .allowsHitTesting(false)
    }

    /// One 128pt tile of grey noise, drawn once and reused.
    private static let grain: UIImage = {
        let side = 128
        var bytes = [UInt8](repeating: 0, count: side * side * 4)
        var seed: UInt64 = 0x9E3779B97F4A7C15
        for i in stride(from: 0, to: bytes.count, by: 4) {
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17
            let v = UInt8(truncatingIfNeeded: seed >> 24)
            bytes[i] = v; bytes[i + 1] = v; bytes[i + 2] = v; bytes[i + 3] = 255
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: &bytes, width: side, height: side, bitsPerComponent: 8,
                                  bytesPerRow: side * 4, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let cg = ctx.makeImage() else { return UIImage() }
        return UIImage(cgImage: cg)
    }()
}

/// One elliptical wash. A radial gradient is round, so it is drawn square and
/// squashed to the shape we want.
private struct Wash: View {
    let color: Color
    let opacity: Double
    let at: UnitPoint
    let w: CGFloat   // width, in screen widths
    let h: CGFloat   // height, in screen heights

    var body: some View {
        GeometryReader { g in
            let rw = g.size.width * w, rh = g.size.height * h
            let side = max(rw, rh)
            RadialGradient(colors: [color.opacity(opacity), color.opacity(0)],
                           center: .center, startRadius: 0, endRadius: side / 2)
                .frame(width: side, height: side)
                .scaleEffect(x: rw / side, y: rh / side)
                .position(x: g.size.width * at.x, y: g.size.height * at.y)
        }
    }
}

/// Takes a tab's list off the system's opaque grouped background and floats it
/// on the wash instead, with the translucent rows Heimat has on the web.
struct HeimatSurface: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .listRowBackground(Color.white.opacity(scheme == .dark ? 0.06 : 0.62))
            // behind the list but in front of the NavigationStack's own opaque
            // background, which is what `scrollContentBackground(.hidden)` uncovers
            .background { HeimatBackground() }
    }
}

extension View {
    /// For a screen built from a `List`.
    func heimatSurface() -> some View { modifier(HeimatSurface()) }
    /// For a screen that lays itself out, with no list rows to restyle.
    func heimatScreen() -> some View { background { HeimatBackground() } }
}
