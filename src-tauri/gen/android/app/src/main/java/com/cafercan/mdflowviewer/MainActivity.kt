package com.cafercan.mdflowviewer

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

/**
 * Arayüzün (public/mobile.js) Android'e özgü işleri: klasör/dosya seçici,
 * depolama izni, "Birlikte aç" ile gelen dosya, bağlantı açma, yazdırma ve
 * sistem çubuklarının rengi. Arayüz bunlara `MDFlowAndroid` nesnesinden
 * ulaşır; sonuçlar `MDFlowMobile.emit(olay, veri)` ile geri bildirilir.
 *
 * Uygulamanın çekirdeği dosyalara gerçek yolla (std::fs) eriştiği için seçici
 * ve "Birlikte aç" adresleri (content://) gerçek yola çevrilir; çevrilemeyen
 * dosyanın kopyası uygulamanın not klasörüne alınır.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var pendingOpen: Uri? = null
  private var inboxDir: String = ""
  private var pendingAction: JSONObject? = null
  private var askedStorage = false
  private var askedInstall = false

  private val folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
    val result = JSONObject()
    if (uri != null) {
      val path = realPath(uri, tree = true)
      if (path != null && File(path).isDirectory) result.put("path", path)
      else result.put("error", "Bu klasöre doğrudan erişilemiyor. Telefonun kendi depolamasından bir klasör seçin.")
    }
    emit("picked", result)
  }

  private val filePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    emit("picked", if (uri != null) localFile(uri) else JSONObject())
  }

  private val legacyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    emit("storage", granted)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) {
      pendingOpen = viewUri(intent)
      pendingAction = intentAction(intent)
    }

    // Sistem çubukları ve klavye kadar iç boşluk: arayüz güvenli alanı hesaplamak zorunda kalmaz.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(Bridge(), "MDFlowAndroid")
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    intentAction(intent)?.let {
      emit("action", it)
      return
    }
    val uri = viewUri(intent) ?: return
    emit("open", localFile(uri))
  }

  override fun onResume() {
    super.onResume()
    if (askedStorage) {
      askedStorage = false
      emit("storage", hasStorageAccess())
    }
    if (askedInstall) {
      askedInstall = false
      emit("install-permission", canInstall())
    }
  }

  private fun viewUri(intent: Intent?): Uri? =
    if (intent?.action == Intent.ACTION_VIEW) intent.data else null

  /** Paylaşılan metin ya da ana ekran kısayolu: `{action, text?, subject?}`. */
  private fun intentAction(intent: Intent?): JSONObject? {
    if (intent == null || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
    val action = intent.action ?: return null
    if (action == Intent.ACTION_SEND) {
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
      return JSONObject().put("action", "share").put("text", text)
        .put("subject", intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "")
    }
    val prefix = "com.cafercan.mdflowviewer.action."
    return if (action.startsWith(prefix)) JSONObject().put("action", action.removePrefix(prefix).lowercase(java.util.Locale.ROOT)) else null
  }

  private fun canInstall(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()

  /** Önbellekteki dosyanın başka uygulamaya verilebilen adresi. */
  private fun sharedUri(file: File): Uri =
    FileProvider.getUriForFile(this, "$packageName.fileprovider", file)

  private fun emit(event: String, data: Any) {
    runOnUiThread {
      webView?.evaluateJavascript(
        "window.MDFlowMobile&&window.MDFlowMobile.emit(${JSONObject.quote(event)},$data)", null)
    }
  }

  private fun hasStorageAccess(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  /** Seçici/"Birlikte aç" adresinin gerçek dosya yolu; çevrilemiyorsa null. */
  private fun realPath(uri: Uri, tree: Boolean = false): String? {
    if (uri.scheme == "file") return uri.path
    if (uri.authority == "com.android.externalstorage.documents") {
      val id = if (tree) DocumentsContract.getTreeDocumentId(uri) else DocumentsContract.getDocumentId(uri)
      val volume = id.substringBefore(':')
      val rest = id.substringAfter(':', "")
      val primary = Environment.getExternalStorageDirectory().path
      val base = when (volume.lowercase()) {
        "primary" -> primary
        "home" -> "$primary/Documents"
        else -> "/storage/$volume"
      }
      return if (rest.isEmpty()) base else "$base/$rest"
    }
    return try {
      contentResolver.query(uri, arrayOf("_data"), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun displayName(uri: Uri): String {
    val name = try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (e: Exception) {
      null
    } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "not.md"
    val clean = name.replace(Regex("[/\\\\:*?\"<>|]"), "-")
    return if (clean.endsWith(".md", true) || clean.endsWith(".markdown", true)) clean else "$clean.md"
  }

  /** `{path}`: dosyanın kendisi; `{path, copied}`: not klasörüne alınan kopyası; `{error}`. */
  private fun localFile(uri: Uri): JSONObject {
    val result = JSONObject()
    val path = realPath(uri)
    if (path != null && File(path).canRead()) return result.put("path", path)
    if (inboxDir.isEmpty()) return result.put("error", "Dosya açılamadı.")
    return try {
      val target = File(inboxDir, displayName(uri))
      target.parentFile?.mkdirs()
      contentResolver.openInputStream(uri)!!.use { input ->
        target.outputStream().use { output -> input.copyTo(output) }
      }
      result.put("path", target.path).put("copied", true)
    } catch (e: Exception) {
      result.put("error", "Dosya açılamadı: ${e.message}")
    }
  }

  inner class Bridge {
    @JavascriptInterface
    fun hasStorageAccess(): Boolean = this@MainActivity.hasStorageAccess()

    /** İzin ekranını açar; dönüşte `storage` olayı (true/false) gelir. */
    @JavascriptInterface
    fun requestStorageAccess() = runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        askedStorage = true
        try {
          startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
        } catch (e: Exception) {
          startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
        }
      } else {
        legacyPermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
      }
    }

    /** Sistem klasör seçicisi; sonuç `picked` olayıyla gelir. */
    @JavascriptInterface
    fun pickFolder() = runOnUiThread { folderPicker.launch(null) }

    @JavascriptInterface
    fun pickFile() = runOnUiThread { filePicker.launch(arrayOf("*/*")) }

    /** Açılışta "Birlikte aç" ile gelen dosya (JSON, yoksa `{}`); kopyalar `inbox` klasörüne alınır. */
    @JavascriptInterface
    fun takeIntentFile(inbox: String): String {
      inboxDir = inbox
      val uri = pendingOpen ?: return "{}"
      pendingOpen = null
      return localFile(uri).toString()
    }

    /** Açılıştaki paylaşım/kısayol (JSON, yoksa `{}`); bir kez verilir. */
    @JavascriptInterface
    fun takeAction(): String {
      val action = pendingAction ?: return "{}"
      pendingAction = null
      return action.toString()
    }

    /** Notu sistemin paylaşım ekranına verir; hata metni ya da "". */
    @JavascriptInterface
    fun shareNote(name: String, text: String, asFile: Boolean): String = try {
      val send = Intent(Intent.ACTION_SEND)
      // Büyük metin Intent'e sığmaz (Binder sınırı): dosya olarak gider.
      if (asFile || text.length > 100_000) {
        val dir = File(cacheDir, "share")
        dir.deleteRecursively()
        dir.mkdirs()
        val file = File(dir, File(name).name)
        file.writeText(text)
        val uri = sharedUri(file)
        send.setType("text/markdown").putExtra(Intent.EXTRA_STREAM, uri)
        send.clipData = android.content.ClipData.newRawUri(name, uri)
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } else {
        send.setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
          .putExtra(Intent.EXTRA_SUBJECT, name.substringBeforeLast('.'))
      }
      startActivity(Intent.createChooser(send, name))
      ""
    } catch (e: Exception) {
      "Paylaşılamadı: ${e.message}"
    }

    @JavascriptInterface
    fun canInstall(): Boolean = this@MainActivity.canInstall()

    /** "Bilinmeyen uygulama" izin ekranı; dönüşte `install-permission` olayı gelir. */
    @JavascriptInterface
    fun requestInstall() = runOnUiThread {
      askedInstall = true
      startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
    }

    /**
     * Güncelleme paketini sistem kurulumuna verir; hata metni ya da "". Yalnız
     * update.rs'in indirdiği klasördeki APK. Sistem, imzası kurulu uygulamanınkiyle
     * aynı olmayan paketi reddeder.
     */
    @JavascriptInterface
    fun installApk(path: String): String = try {
      val file = File(path).canonicalFile
      val dir = File(cacheDir, "updates").canonicalFile
      if (file.parentFile != dir || file.extension != "apk" || !file.isFile) {
        "Güncelleme paketi bulunamadı."
      } else {
        startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(sharedUri(file), "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        )
        ""
      }
    } catch (e: Exception) {
      "Kurulum başlatılamadı: ${e.message}"
    }

    @JavascriptInterface
    fun openUrl(url: String): Boolean {
      val low = url.trim().lowercase()
      if (!(low.startsWith("http://") || low.startsWith("https://") || low.startsWith("mailto:"))) return false
      return try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())))
        true
      } catch (e: Exception) {
        false
      }
    }

    /** Sistem yazdırma ekranı ("PDF olarak kaydet" dahil). */
    @JavascriptInterface
    fun print(title: String) = runOnUiThread {
      val view = webView ?: return@runOnUiThread
      val manager = getSystemService(Context.PRINT_SERVICE) as PrintManager
      manager.print(title, view.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
    }

    /** Durum/gezinme çubuğunun zemini ve simge rengi (tema değişince). */
    @JavascriptInterface
    fun setChrome(color: String, dark: Boolean) = runOnUiThread {
      val parsed = try { Color.parseColor(color) } catch (e: Exception) { return@runOnUiThread }
      findViewById<View>(android.R.id.content).setBackgroundColor(parsed)
      window.decorView.setBackgroundColor(parsed)
      WindowCompat.getInsetsController(window, window.decorView).apply {
        isAppearanceLightStatusBars = !dark
        isAppearanceLightNavigationBars = !dark
      }
    }

    /** Geri tuşuyla kapatılacak bir şey kalmadı: uygulama arka plana geçer. */
    @JavascriptInterface
    fun moveToBack() = runOnUiThread { moveTaskToBack(true) }
  }
}
