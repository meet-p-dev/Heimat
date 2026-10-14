import Foundation
import Compression

/// Reading an Excel file (.xlsx) as plain rows of text, for the importers — the same as the web
/// app's src/lib/xlsx.ts (every sheet, shared and inline strings, numbers, booleans; no
/// formulas worked out, no styles read, so a date stored as a number arrives as that number).
/// An .xlsx is a zip of XML files; its entries are inflated with Apple's Compression framework.
enum Xlsx {
    enum Failure: Error { case notZip, badZip }

    private static func u16(_ b: [UInt8], _ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 }
    private static func u32(_ b: [UInt8], _ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 | Int(b[i + 2]) << 16 | Int(b[i + 3]) << 24 }

    private static func inflate(_ src: ArraySlice<UInt8>, size: Int) -> [UInt8]? {
        if size == 0 { return [] }
        var out = [UInt8](repeating: 0, count: size)
        let n = Array(src).withUnsafeBufferPointer { s in
            out.withUnsafeMutableBufferPointer { d in
                compression_decode_buffer(d.baseAddress!, size, s.baseAddress!, s.count, nil, COMPRESSION_ZLIB)
            }
        }
        return n == size ? out : nil
    }

    /// every file in the zip, by name
    static func unzip(_ data: Data) throws -> [String: [UInt8]] {
        let b = [UInt8](data)
        guard b.count >= 22 else { throw Failure.notZip }
        var eocd = -1
        var i = b.count - 22
        while i >= max(0, b.count - 65557) { if u32(b, i) == 0x06054b50 { eocd = i; break }; i -= 1 }
        guard eocd >= 0 else { throw Failure.notZip }
        let count = u16(b, eocd + 10)
        var p = u32(b, eocd + 16)
        var files: [String: [UInt8]] = [:]
        for _ in 0..<count {
            guard p + 46 <= b.count, u32(b, p) == 0x02014b50 else { throw Failure.badZip }
            let method = u16(b, p + 10), size = u32(b, p + 20), full = u32(b, p + 24)
            let nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32), local = u32(b, p + 42)
            let name = String(decoding: b[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
            p += 46 + nameLen + extra + comment
            guard local + 30 <= b.count, u32(b, local) == 0x04034b50 else { throw Failure.badZip }
            let start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
            guard start + size <= b.count else { throw Failure.badZip }
            let raw = b[start..<(start + size)]
            if method == 0 { files[name] = Array(raw) }
            else if method == 8 { guard let out = inflate(raw, size: full) else { throw Failure.badZip }; files[name] = out }
        }
        return files
    }

    private static func matches(_ pattern: String, _ s: String) -> [[String?]] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        return re.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { m in
            (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } }
        }
    }
    private static func first(_ pattern: String, _ s: String) -> String? { matches(pattern, s).first?[1] ?? nil }

    static func unescape(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = "", i = s.startIndex
        while i < s.endIndex {
            if s[i] == "&", let semi = s[i...].firstIndex(of: ";"), s.distance(from: i, to: semi) <= 10 {
                let ent = String(s[s.index(after: i)..<semi])
                var rep: String?
                switch ent {
                case "amp": rep = "&"
                case "lt": rep = "<"
                case "gt": rep = ">"
                case "quot": rep = "\""
                case "apos": rep = "'"
                default:
                    if ent.hasPrefix("#x"), let v = UInt32(ent.dropFirst(2), radix: 16), let u = Unicode.Scalar(v) { rep = String(u) }
                    else if ent.hasPrefix("#"), let v = UInt32(ent.dropFirst()), let u = Unicode.Scalar(v) { rep = String(u) }
                }
                if let rep { out += rep; i = s.index(after: semi); continue }
            }
            out.append(s[i]); i = s.index(after: i)
        }
        return out
    }

    /// the text of every <t> inside, in order (a rich-text string is several runs)
    private static func textOf(_ xml: String) -> String {
        matches("<t(?:\\s[^>]*)?>([\\s\\S]*?)</t>", xml).map { unescape($0[1] ?? "") }.joined()
    }
    /// "AB12" → 27 (zero-based column)
    private static func colOf(_ ref: String) -> Int {
        var n = 0
        for ch in ref.unicodeScalars where ch.value >= 65 && ch.value <= 90 { n = n * 26 + Int(ch.value - 64) }
        return n - 1
    }
    /// a number as Excel stored it, without binary noise, written as the web app writes it
    static func cleanNumber(_ v: String) -> String {
        guard let n = Double(v), n.isFinite, let r = Double(String(format: "%.15g", n)) else { return v }
        if r == r.rounded(), abs(r) < 1e15 { return String(Int64(r)) }
        return "\(r)"
    }

    static func sheets(_ files: [String: [UInt8]]) -> [[[String]]] {
        func get(_ n: String) -> String? { files[n].map { String(decoding: $0, as: UTF8.self) } }
        let shared = matches("<si>([\\s\\S]*?)</si>", get("xl/sharedStrings.xml") ?? "").map { textOf($0[1] ?? "") }
        let wb = get("xl/workbook.xml") ?? ""
        var rels: [String: String] = [:]
        for m in matches("<Relationship\\b[^>]*>", get("xl/_rels/workbook.xml.rels") ?? "") {
            let tag = m[0] ?? ""
            let id = first("\\bId=\"([^\"]*)\"", tag) ?? "", target = first("\\bTarget=\"([^\"]*)\"", tag) ?? ""
            let t = target.replacingOccurrences(of: "^/?(xl/)?", with: "", options: .regularExpression)
            rels[id] = "xl/" + t
        }
        let paths = matches("<sheet\\b[^>]*>", wb).compactMap { m in rels[first("\\br:id=\"([^\"]*)\"", m[0] ?? "") ?? ""] }.filter { !$0.isEmpty }
        let list = !paths.isEmpty ? paths : files.keys.filter { $0.range(of: "^xl/worksheets/sheet\\d+\\.xml$", options: .regularExpression) != nil }.sorted()
        return list.map { path in
            let xml = get(path) ?? ""
            var rows: [[String]] = []
            for rm in matches("<row\\b[^>]*?(?:/>|>([\\s\\S]*?)</row>)", xml) {
                var row: [String] = []
                var next = 0
                for cm in matches("<c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</c>)", rm[1] ?? "") {
                    let attrs = cm[1] ?? "", inner = cm[2] ?? ""
                    let col = first("\\br=\"([A-Z]+\\d+)\"", attrs).map(colOf) ?? next
                    next = col + 1
                    let t = first("\\bt=\"([^\"]*)\"", attrs) ?? "n"
                    let v = first("<v>([\\s\\S]*?)</v>", inner)
                    var text = ""
                    switch t {
                    case "s": if let v, let k = Int(v), k >= 0, k < shared.count { text = shared[k] }
                    case "inlineStr": text = textOf(inner)
                    case "str", "e": text = v.map(unescape) ?? ""
                    case "b": text = v == "1" ? "TRUE" : v == "0" ? "FALSE" : ""
                    default: text = v.map { cleanNumber(unescape($0)) } ?? ""
                    }
                    while row.count < col { row.append("") }
                    if row.count == col { row.append(text) } else { row[col] = text }
                }
                rows.append(row)
            }
            return rows
        }
    }

    static func read(_ data: Data) throws -> [[[String]]] { sheets(try unzip(data)) }

    /// a zip file starts "PK\3\4"
    static func isZip(_ data: Data) -> Bool { data.count > 4 && data.prefix(4) == Data([0x50, 0x4b, 3, 4]) }
}
