import PhotosUI
import SwiftUI
import VisionKit

/// What the expense form takes from a scanned receipt.
struct ReceiptUse {
    var result: Receipt.Result
    /// split it line by line (only offered when the lines add up to the total)
    var byItem: Bool
}

/// Add expense → Scan a receipt: the camera's document scanner (it finds the paper
/// and lays it flat) or a photo from the library, then what was read, to check
/// before any of it goes into the expense. Everything happens on the phone.
struct ReceiptScanButton: View {
    let use: (ReceiptUse) -> Void
    @State private var choosing = false
    @State private var camera = false
    @State private var picked: PhotosPickerItem?
    @State private var library = false
    @State private var pages: [UIImage]?

    var body: some View {
        Button { choosing = true } label: {
            Label("Scan a receipt", systemImage: "doc.text.viewfinder")
        }
        .confirmationDialog("Scan a receipt", isPresented: $choosing, titleVisibility: .hidden) {
            if VNDocumentCameraViewController.isSupported {
                Button("Take a photo") { camera = true }
            }
            Button("Choose from Photos") { library = true }
        }
        .photosPicker(isPresented: $library, selection: $picked, matching: .images)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            picked = nil
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { pages = [img] }
            }
        }
        .fullScreenCover(isPresented: $camera) {
            DocumentCamera { scanned in
                camera = false
                if !scanned.isEmpty { pages = scanned }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: Binding(get: { pages != nil }, set: { if !$0 { pages = nil } })) {
            if let pages {
                ReceiptReview(pages: pages) { u in self.pages = nil; use(u) }
            }
        }
    }
}

/// The system's document scanner — the one Notes and Files use.
private struct DocumentCamera: UIViewControllerRepresentable {
    let done: ([UIImage]) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let c = VNDocumentCameraViewController()
        c.delegate = context.coordinator
        return c
    }
    func updateUIViewController(_ c: VNDocumentCameraViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let done: ([UIImage]) -> Void
        init(done: @escaping ([UIImage]) -> Void) { self.done = done }
        func documentCameraViewController(_ c: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            done((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }
        func documentCameraViewControllerDidCancel(_ c: VNDocumentCameraViewController) { done([]) }
        func documentCameraViewController(_ c: VNDocumentCameraViewController, didFailWithError error: Error) { done([]) }
    }
}

/// What was read off the receipt, to check before it goes into the expense.
struct ReceiptReview: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let pages: [UIImage]
    let use: (ReceiptUse) -> Void
    @State private var result: Receipt.Result?
    /// every page read steadily: its lines can be split one by one
    @State private var steady = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Group {
                if let result { reviewed(result) }
                else if failed { nothing }
                else {
                    VStack(spacing: 14) {
                        ProgressView()
                        Text("Reading the receipt…").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("Receipt")
            .navigationBarTitleDisplayMode(.inline)
            .heimatSurface()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .task { await read() }
    }

    private func read() async {
        var rows: [String] = []
        var allSteady = true
        for page in pages {
            guard let cg = page.cgImage, let p = try? await ReceiptOCR.page(cg, orientation: CGImagePropertyOrientation(page.imageOrientation)) else { allSteady = false; continue }
            rows += p.rows
            allSteady = allSteady && p.steady
        }
        let r = Receipt.read(rows)
        steady = allSteady
        if r.total == nil && r.items.isEmpty { failed = true } else { result = r }
    }

    private var nothing: some View {
        ContentUnavailableView {
            Label("Couldn't read a total", systemImage: "doc.text.magnifyingglass")
        } description: {
            Text("Lay the receipt flat in good light, with the whole of it in the photo.")
        } actions: {
            Button("Type it in instead") { dismiss() }.glassButton()
        }
    }

    private func reviewed(_ r: Receipt.Result) -> some View {
        let cur = m.hostCur
        // the lines add up, and came out the same however the photo's tilt was taken
        let byLine = r.itemsMatch && steady
        func money(_ minor: Int) -> String { Fmt.money(Money.toMajor(minor, cur), cur) }
        return Form {
            Section {
                HStack(alignment: .center, spacing: 14) {
                    if let first = pages.first {
                        Image(uiImage: first).resizable().scaledToFill()
                            .frame(width: 64, height: 86).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Total").font(.subheadline).foregroundStyle(.secondary)
                        Text(r.total.map(money) ?? "Not found").font(.system(size: 32, weight: .bold, design: .rounded)).monospacedDigit()
                        if r.total != nil && !r.totalSure {
                            Label("Check it matches the receipt", systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote.weight(.semibold)).foregroundStyle(.orange)
                        }
                    }
                }
                .padding(.vertical, 4)
                if let store = r.store { LabeledContent("Shop", value: store) }
                if let d = r.date { LabeledContent("Date", value: Fmt.relDay(d)) }
            }

            if !r.items.isEmpty {
                Section {
                    ForEach(Array(r.items.enumerated()), id: \.offset) { _, it in
                        LabeledContent(it.name, value: money(it.minor)).monospacedDigit()
                    }
                    if r.discount > 0 { LabeledContent("Taken off", value: "−" + money(r.discount)).monospacedDigit() }
                } header: { Text("\(r.items.count) \(r.items.count == 1 ? "line" : "lines")") } footer: {
                    if byLine {
                        Label("The lines add up to the total", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    } else if r.itemsMatch {
                        Text("The photo is a little tilted, so a price may sit next to the wrong line. Split it equally — or for line by line, scan it again with the camera, flat and straight.")
                    } else {
                        Text("Not every line could be read, so they don't add up to the total. Split it equally, or add the lines yourself.")
                    }
                }
            }

            Section {
                Button { use(ReceiptUse(result: r, byItem: false)) } label: {
                    Text("Split equally").font(.headline).frame(maxWidth: .infinity)
                }
                .glassProminentButton().controlSize(.large)
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                if byLine {
                    Button { use(ReceiptUse(result: r, byItem: true)) } label: {
                        Text("Split line by line").font(.headline).frame(maxWidth: .infinity)
                    }
                    .glassButton().controlSize(.large)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 0, trailing: 0))
                }
            } footer: {
                Text(byLine ? "Line by line: tick who had what on the next screen." : "You can change anything on the next screen.")
                    .frame(maxWidth: .infinity, alignment: .center).padding(.top, 6)
            }
        }
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
