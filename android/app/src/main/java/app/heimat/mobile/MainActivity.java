package app.heimat.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // the app's own plugins, before the bridge starts
        registerPlugin(ReceiptScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
