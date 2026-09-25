package dev.kennjanali.pos034;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins register before the bridge starts.
        registerPlugin(BluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
