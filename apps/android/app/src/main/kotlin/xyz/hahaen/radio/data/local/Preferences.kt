package xyz.hahaen.radio.data.local

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.preferences by preferencesDataStore("listening")
data class ListeningPreferences(val powerSave: Boolean = false, val reduceMotion: Boolean = false,
    val scene: String = "ocean", val graphics: Boolean = true, val pinned: Boolean = false)
@Singleton class Preferences @Inject constructor(@ApplicationContext private val context: Context) {
    private val power = booleanPreferencesKey("power_save")
    private val motion = booleanPreferencesKey("reduce_motion")
    private val scene = stringPreferencesKey("scene")
    private val graphics = booleanPreferencesKey("graphics")
    private val pinned = booleanPreferencesKey("pinned")
    val state = context.preferences.data.map { ListeningPreferences(it[power] ?: false, it[motion] ?: false,
        it[scene] ?: "ocean", it[graphics] ?: true, it[pinned] ?: false) }
    suspend fun boolean(key: String, value: Boolean) {
        require(key in setOf("power_save", "reduce_motion", "graphics", "pinned"))
        context.preferences.edit { it[booleanPreferencesKey(key)] = value }
    }
    suspend fun scene(value: String) { require(value in setOf("ocean", "aurora", "mountains")); context.preferences.edit { it[scene] = value } }
}
