import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision

/// A photo of a receipt → its printed lines, top to bottom, for `Receipt.read`.
///
/// Text recognition hands back pieces of text with where they sit; on a receipt
/// the name of a line and its price come back as two pieces, far apart. Pieces
/// whose middles sit at the same height are one printed line. A photo taken at a
/// slight angle tilts every line by the same angle: the receipt is cut out and laid
/// flat when its edges show, and the angle that is left is found from its columns.
/// Runs on the phone — nothing leaves the device.
enum ReceiptOCR {
    struct Piece {
        var text: String
        /// in pixels, y growing upwards as Vision has it
        var midX: Double, midY: Double, minX: Double, maxX: Double, height: Double
    }

    /// One page as lines, and whether its lines can be trusted one by one.
    struct Page {
        var rows: [String]
        /// The same lines with the same prices come out when the tilt is taken half a
        /// degree either way. A reading that changes with that little has paired names
        /// and prices by chance — its lines can still add up (the same prices, each
        /// one line off), so only a steady reading is split line by line.
        var steady: Bool
    }

    /// A page of a receipt, read the way that makes the most sense of it.
    ///
    /// The paper's outline can be found wrong, and then straightening squashes the
    /// lines together. So the photo is read straightened and as taken, each put into
    /// lines at the tilt its columns show (`columnTilt`), and the reading where the
    /// receipt agrees with itself wins — its lines add up to the total, a card line
    /// repeats it; the straightened one when they agree equally. (Trying other angles
    /// as well reads more photos, but some angle can always be found at which a
    /// receipt that was misread seems to agree with itself — never worth that.)
    static func page(_ photo: CGImage, orientation: CGImagePropertyOrientation = .up, now: Date = Date()) async throws -> Page {
        var images: [[Piece]] = []
        if let flat = await straightened(photo, orientation: orientation) { images.append(try await read(flat, orientation: .up)) }
        images.append(try await read(photo, orientation: orientation))
        func score(_ r: Receipt.Result) -> Int { (r.itemsMatch ? 4 : 0) + (r.totalSure ? 2 : 0) + (r.total != nil ? 1 : 0) }
        var best: (score: Int, page: Page)?
        for pieces in images {
            let angle = atan(columnTilt(pieces))
            func at(_ nudge: Double) -> [String] { lines(pieces, tilt: tan(angle + nudge * .pi / 180)) }
            let rows = at(0), r = Receipt.read(rows, now: now)
            let steady = [-0.5, 0.5].allSatisfy { Receipt.read(at($0), now: now).items == r.items }
            let sc = score(r)
            if best == nil || sc > best!.score { best = (sc, Page(rows: rows, steady: steady)) }
        }
        #if DEBUG
        NSLog("receipt: \(images.count) readings, column tilt \(images.map { atan(columnTilt($0)) * 180 / .pi }), score \(best?.score ?? -1), steady \(best?.page.steady ?? false)")
        #endif
        return best?.page ?? Page(rows: [], steady: false)
    }

    static func rows(_ photo: CGImage, orientation: CGImagePropertyOrientation = .up, now: Date = Date()) async throws -> [String] {
        try await page(photo, orientation: orientation, now: now).rows
    }

    /// The tilt at which the receipt's columns stand straightest: the names start at
    /// one edge and the prices end at the other, all the way down. Over the height of
    /// a whole receipt a wrong angle leans those edges far apart — unlike the lines,
    /// where tilting a line's height too far just pairs each price with the next name.
    static func columnTilt(_ pieces: [Piece]) -> Double {
        guard pieces.count >= 4 else { return 0 }
        let hs = pieces.map(\.height).sorted()
        let tol = 0.5 * hs[hs.count / 4]
        /// the biggest group of edges within `tol` of each other on that side of the
        /// receipt, and how tightly they line up (lower is straighter)
        func edge(_ xs: [Double], left: Bool) -> (count: Int, spread: Double) {
            let s = xs.sorted()
            let limit = Int(Double(s.count) * (left ? 0.4 : 0.6))
            var best = (count: 0, spread: Double.infinity), j = 0
            for i in s.indices {
                while s[i] - s[j] > tol { j += 1 }
                guard left ? j <= limit : i >= limit else { continue }
                let group = s[j...i], n = i - j + 1
                let mean = group.reduce(0, +) / Double(n)
                let spread = group.reduce(0) { $0 + abs($1 - mean) } / Double(n)
                if n > best.count || n == best.count && spread < best.spread { best = (n, spread) }
            }
            return best
        }
        var best = (count: -1, spread: Double.infinity, tilt: 0.0)
        // ±10° in quarter degrees, straight first
        for step in [0] + (1...40).flatMap({ [$0, -$0] }) {
            let t = tan(Double(step) * 0.25 * .pi / 180)
            let l = edge(pieces.map { $0.minX + t * $0.midY }, left: true)
            let r = edge(pieces.map { $0.maxX + t * $0.midY }, left: false)
            let count = l.count + r.count, spread = l.spread + r.spread
            // more edges in line, or as many standing straighter
            if count > best.count || count == best.count && spread < best.spread - 0.01 { best = (count, spread, t) }
        }
        return best.tilt
    }

    /// the pieces of text on one image, and how far its lines are tilted
    static func read(_ image: CGImage, orientation: CGImagePropertyOrientation) async throws -> [Piece] {
        var request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = [Locale.Language(identifier: "de-DE"), Locale.Language(identifier: "en-US")]
        request.usesLanguageCorrection = true
        let found = try await request.perform(on: image, orientation: orientation)
        // turned a quarter: the picture's width is the text's height
        let sideways = [.left, .right, .leftMirrored, .rightMirrored].contains(orientation)
        let w = Double(sideways ? image.height : image.width), h = Double(sideways ? image.width : image.height)
        let pieces: [Piece] = found.compactMap { o in
            guard let text = o.topCandidates(1).first?.string, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            let xs = [o.topLeft.x, o.topRight.x, o.bottomLeft.x, o.bottomRight.x].map { $0 * w }
            let ys = [o.topLeft.y, o.topRight.y, o.bottomLeft.y, o.bottomRight.y].map { $0 * h }
            return Piece(text: text, midX: xs.reduce(0, +) / 4, midY: ys.reduce(0, +) / 4,
                         minX: xs.min()!, maxX: xs.max()!, height: max(ys.max()! - ys.min()!, 1))
        }
        return pieces
    }

    /// The receipt cut out of the photo and laid flat — as the camera's document
    /// scanner does, for a photo picked from the library. Nil when no sheet of paper
    /// stands out clearly enough; then the photo is read as it is.
    static func straightened(_ image: CGImage, orientation: CGImagePropertyOrientation) async -> CGImage? {
        guard let doc = try? await DetectDocumentSegmentationRequest().perform(on: image, orientation: orientation),
              doc.confidence > 0.5 else { return nil }
        let upright = CIImage(cgImage: image).oriented(orientation)
        let w = upright.extent.width, h = upright.extent.height
        func pt(_ p: NormalizedPoint) -> CIVector { CIVector(x: p.x * w, y: p.y * h) }
        // a quad too small to be the receipt is something else on the table
        let area = abs((doc.topRight.x - doc.bottomLeft.x) * (doc.topLeft.y - doc.bottomRight.y))
        guard area > 0.15 else { return nil }
        let f = CIFilter(name: "CIPerspectiveCorrection")!
        f.setValue(upright, forKey: kCIInputImageKey)
        f.setValue(pt(doc.topLeft), forKey: "inputTopLeft")
        f.setValue(pt(doc.topRight), forKey: "inputTopRight")
        f.setValue(pt(doc.bottomRight), forKey: "inputBottomRight")
        f.setValue(pt(doc.bottomLeft), forKey: "inputBottomLeft")
        guard let out = f.outputImage else { return nil }
        return CIContext().createCGImage(out, from: out.extent)
    }

    /// pieces → printed lines, top first
    static func lines(_ pieces: [Piece], tilt t: Double) -> [String] {
        guard !pieces.isEmpty else { return [] }
        // a piece's own height, less what the tilt adds across its width
        let level = pieces.map { p in
            var q = p
            q.height = max(p.height - abs(t) * (p.maxX - p.minX), p.height * 0.3)
            return (p: q, y: p.midY - t * p.midX)
        }.sorted { $0.y > $1.y }
        var rows: [(y: Double, h: Double, items: [Piece])] = []
        for (p, y) in level {
            if let last = rows.indices.last, abs(rows[last].y - y) < 0.5 * min(rows[last].h, p.height) {
                let n = Double(rows[last].items.count)
                rows[last].y = (rows[last].y * n + y) / (n + 1)
                rows[last].h = max(rows[last].h, p.height)
                rows[last].items.append(p)
            } else {
                rows.append((y, p.height, [p]))
            }
        }
        return rows.map { $0.items.sorted { $0.minX < $1.minX }.map(\.text).joined(separator: "  ") }
    }
}
