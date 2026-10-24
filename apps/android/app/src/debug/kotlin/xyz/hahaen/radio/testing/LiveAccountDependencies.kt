package xyz.hahaen.radio.testing

import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import xyz.hahaen.radio.data.local.RadioDatabase
import xyz.hahaen.radio.data.remote.RadioApi
import xyz.hahaen.radio.data.repository.LibraryRepository

/** Debug-only access to existing dependencies for read-only instrumentation verification. */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface LiveAccountDependencies {
    fun library(): LibraryRepository
    fun api(): RadioApi
    fun database(): RadioDatabase
    fun json(): Json
}
