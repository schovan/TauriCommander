package com.schov.tauri_commander

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    requestStorageAccess()
  }

  private fun requestStorageAccess() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (!Environment.isExternalStorageManager()) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
        intent.data = Uri.parse("package:$packageName")
        try {
          startActivity(intent)
        } catch (_: Exception) {
          try {
            startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
          } catch (_: Exception) {
            // The device does not expose the all-files settings screen.
          }
        }
      }
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val requested = arrayOf(
        Manifest.permission.READ_EXTERNAL_STORAGE,
        Manifest.permission.WRITE_EXTERNAL_STORAGE,
      ).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        .toTypedArray()
      if (requested.isNotEmpty()) {
        requestPermissions(requested, STORAGE_PERMISSION_REQUEST_CODE)
      }
    }
  }

  companion object {
    private const val STORAGE_PERMISSION_REQUEST_CODE = 1001
  }
}
