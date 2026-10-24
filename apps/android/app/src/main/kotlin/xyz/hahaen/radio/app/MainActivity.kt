package xyz.hahaen.radio.app

import android.Manifest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import dagger.hilt.android.AndroidEntryPoint
import xyz.hahaen.radio.feature.RadioViewModel
import xyz.hahaen.radio.feature.RadioApp
import xyz.hahaen.radio.playback.PlaybackConnection
import javax.inject.Inject

@AndroidEntryPoint class MainActivity : AppCompatActivity() {
    @Inject lateinit var playback: PlaybackConnection
    private val model: RadioViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = AudioManager.STREAM_MUSIC
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        setContent { RadioApp(model, playback) }
        if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    override fun onStart() { super.onStart(); playback.connect(); playback.prepare(); model.library.refresh() }
    override fun onStop() { playback.disconnect(); super.onStop() }
}
