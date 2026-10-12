package app.heimat.mobile;

import android.app.Activity;
import android.graphics.Point;
import android.net.Uri;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Add expense → Scan a receipt, on Android: Google's document scanner (it finds the
 * paper, lays it flat, and can take a photo from the gallery instead), then the text on
 * each page read on the phone. Hands back the pieces of text with where they sit; the
 * app puts them into lines and reads the receipt (src/lib/receiptOcr.ts, receipt.ts).
 * Nothing leaves the device — both run in Google Play services on the phone.
 */
@CapacitorPlugin(name = "ReceiptScanner")
public class ReceiptScannerPlugin extends Plugin {
    private static final String TAG = "Receipt";
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall pending;
    private final ExecutorService work = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        launcher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::scanned);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (pending != null) { call.reject("A scan is already open", "busy"); return; }
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(3)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build();
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        pending = call;
        call.setKeepAlive(true);
        scanner.getStartScanIntent(getActivity())
            .addOnSuccessListener(sender -> launcher.launch(new IntentSenderRequest.Builder(sender).build()))
            .addOnFailureListener(e -> {
                // no Play services, or the scanner couldn't be fetched: the form says to type it in
                Log.w(TAG, "scanner unavailable: " + e.getClass().getSimpleName());
                finish().reject("The scanner isn't available on this phone", "unavailable");
            });
    }

    private PluginCall finish() {
        PluginCall c = pending;
        pending = null;
        if (c != null) c.setKeepAlive(false);
        return c;
    }

    private void scanned(ActivityResult result) {
        PluginCall call = finish();
        if (call == null) return;
        GmsDocumentScanningResult r = result.getResultCode() == Activity.RESULT_OK
            ? GmsDocumentScanningResult.fromActivityResultIntent(result.getData()) : null;
        if (r == null || r.getPages() == null || r.getPages().isEmpty()) {
            JSObject none = new JSObject();
            none.put("pages", new JSArray());
            call.resolve(none);
            return;
        }
        List<GmsDocumentScanningResult.Page> pages = r.getPages();
        work.execute(() -> {
            TextRecognizer reader = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            JSArray out = new JSArray();
            try {
                for (GmsDocumentScanningResult.Page page : pages) out.put(read(reader, page.getImageUri()));
                JSObject res = new JSObject();
                res.put("pages", out);
                call.resolve(res);
            } catch (Exception e) {
                Log.w(TAG, "couldn't read a page: " + e.getClass().getSimpleName());
                call.reject("Couldn't read the receipt", "failed");
            } finally {
                reader.close();
            }
        });
    }

    /** one page: its pieces of text, y turned to grow upwards as the iPhone's Vision has it */
    private JSObject read(TextRecognizer reader, Uri uri) throws Exception {
        InputImage image = InputImage.fromFilePath(getContext(), uri);
        Task<Text> t = reader.process(image);
        Text text = Tasks.await(t);
        double h = image.getHeight();
        JSArray pieces = new JSArray();
        int count = 0;
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Point[] c = line.getCornerPoints();
                String s = line.getText();
                if (c == null || c.length < 4 || s == null || s.trim().isEmpty()) continue;
                double minX = Double.MAX_VALUE, maxX = -Double.MAX_VALUE, minY = Double.MAX_VALUE, maxY = -Double.MAX_VALUE, sx = 0, sy = 0;
                for (Point p : c) {
                    double x = p.x, y = h - p.y;
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    sx += x; sy += y;
                }
                JSObject piece = new JSObject();
                piece.put("text", s);
                piece.put("midX", sx / c.length);
                piece.put("midY", sy / c.length);
                piece.put("minX", minX);
                piece.put("maxX", maxX);
                piece.put("height", Math.max(maxY - minY, 1));
                pieces.put(piece);
                count++;
            }
        }
        // sizes and counts only — never what the receipt says
        Log.i(TAG, "page " + image.getWidth() + "x" + image.getHeight() + ": " + count + " pieces");
        JSObject page = new JSObject();
        page.put("uri", uri.toString());
        page.put("pieces", pieces);
        return page;
    }
}
