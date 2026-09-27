package com.kennali.pos034;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.util.UUID;

/**
 * Receipt printing over Bluetooth Classic (the serial port profile), which is
 * what cheap 58/80 mm thermal printers speak. The printer is paired once in
 * Android's Bluetooth settings; the app lists paired devices and sends raw
 * ESC/POS bytes. Connect, write, close — per receipt, so a printer switched
 * off between receipts costs nothing.
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
)
public class BluetoothPrinterPlugin extends Plugin {

    /** The standard serial port profile UUID. */
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "afterPermission");
            return;
        }
        listPairedDevices(call);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "afterPermission");
            return;
        }
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("A printer address and the receipt data are required.");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        // Bluetooth I/O blocks; never on the UI thread.
        getBridge().execute(() -> send(call, address, bytes));
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (needsPermission()) {
            call.reject("Bluetooth permission was not granted.");
        } else if ("print".equals(call.getMethodName())) {
            print(call);
        } else {
            listPairedDevices(call);
        }
    }

    /** Android 12+ asks at runtime; older versions grant it at install. */
    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    @SuppressLint("MissingPermission") // checked in needsPermission()
    private void listPairedDevices(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on in Android settings.");
            return;
        }
        JSArray devices = new JSArray();
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            JSObject item = new JSObject();
            item.put("name", device.getName() == null ? device.getAddress() : device.getName());
            item.put("address", device.getAddress());
            devices.put(item);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @SuppressLint("MissingPermission") // checked in needsPermission()
    private void send(PluginCall call, String address, byte[] bytes) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on in Android settings.");
            return;
        }
        try (BluetoothSocket socket = adapter.getRemoteDevice(address).createRfcommSocketToServiceRecord(SPP)) {
            adapter.cancelDiscovery(); // discovery slows or breaks a connect
            socket.connect();
            OutputStream out = socket.getOutputStream();
            out.write(bytes);
            out.flush();
            // Let the printer's buffer drain before the socket drops.
            Thread.sleep(300);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not reach the printer. Check it is on, paired and has paper.", e);
        }
    }
}
