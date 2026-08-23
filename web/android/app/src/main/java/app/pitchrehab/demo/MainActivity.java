package app.pitchrehab.demo;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * The app is one WebView running the same front end the browser runs.
 *
 * The only thing added here is keeping the screen alive. A player props the
 * phone up and walks three metres away to do their set; if the screen sleeps,
 * the video track stalls and the rep count stops, which looks exactly like the
 * pose engine failing rather than like a screen timeout.
 *
 * The browser build handles that with the Screen Wake Lock API, which Android's
 * WebView does not reliably expose. This is the blunter version: the screen
 * stays on for as long as the app is in front. Blunter because it also applies
 * while you are reading the progress charts, which costs battery it does not
 * need to -- an acceptable trade against a rep count that silently stops.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }
}
