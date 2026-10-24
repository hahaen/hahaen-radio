package xyz.hahaen.radio

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import xyz.hahaen.radio.data.remote.SecureSession
import xyz.hahaen.radio.data.repository.RoomLibraryStorage
import xyz.hahaen.radio.domain.Library
import xyz.hahaen.radio.domain.ListeningCollection
import xyz.hahaen.radio.domain.validated
import xyz.hahaen.radio.testing.LiveAccountDependencies

/** Explicitly enabled, read-only verification of the user's already synchronized account. */
class LiveAccountReadOnlyTest {
    @Test fun persistedAccountAndAllCollectionKindsMatchServerWithoutWriting() {
        assumeTrue("Requires explicit haenLiveAccount=true", InstrumentationRegistry.getArguments().getString("haenLiveAccount") == "true")
        var stage = "dependency initialization"
        try {
            runBlocking {
                withTimeout(60_000) {
                    val context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
                    val dependencies = EntryPointAccessors.fromApplication(context, LiveAccountDependencies::class.java)
                    val json = dependencies.json()

                    stage = "persisted session restoration"
                    // Recreate the production decryptor from disk while forbidding its recovery/clear writes.
                    val readOnlyContext = object : ContextWrapper(context) {
                        override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                            val original = context.getSharedPreferences(name, mode)
                            return object : SharedPreferences by original {
                                override fun edit(): SharedPreferences.Editor = error("READ_ONLY_SESSION_PROBE")
                            }
                        }
                    }
                    val restoredSession = SecureSession(readOnlyContext, json)
                    val persistedUser = restoredSession.user()
                    assertTrue("A persisted signed-in session is required", persistedUser != null)
                    val owner = requireNotNull(persistedUser).id
                    assertTrue("Restored session must contain one cookie for the configured API", restoredSession.loadForRequest(BuildConfig.API_BASE_URL.toHttpUrl()).size == 1)
                    val repository = dependencies.library()
                    val api = dependencies.api()
                    val database = dependencies.database()
                    assertTrue("Repository must restore the persisted identity", repository.account.value.user?.id == owner)
                    assertTrue("Wait for the existing account sync to finish before this check", !repository.account.value.syncing)
                    assertTrue("There must be no pending local operations before reading", database.dao().pendingSize(owner) == 0)

                    stage = "authenticated session GET"
                    val serverUser = api.session().user?.validated()
                    assertTrue("The server must recognize the restored session", serverUser?.id == owner)

                    stage = "local persisted collection read"
                    val localEntity = RoomLibraryStorage(database).library(owner)
                    assertTrue("A persisted account library is required", localEntity != null)
                    val entity = requireNotNull(localEntity)
                    val local = Library(entity.revision, json.decodeFromString<ListeningCollection>(entity.json)).validated()
                    val owned = repository.ownedCollections.first { it.first == owner && it.second == local.collection }
                    assertTrue("The visible collection must belong to the restored account", owned.first == owner)

                    stage = "authenticated library GET"
                    val remote = api.library(owner).validated()
                    // Boolean assertions deliberately avoid printing either collection on failure.
                    assertTrue("Persisted favorites must match the server", local.collection.favorites == remote.collection.favorites)
                    assertTrue("Persisted listening history must match the server", local.collection.history == remote.collection.history)
                    assertTrue("Persisted saved songs must match the server", local.collection.songs == remote.collection.songs)
                    assertTrue("Persisted and server revisions must match", local.revision == remote.revision)

                    stage = "final identity and pending-operation check"
                    assertTrue("The account identity must remain unchanged", repository.account.value.user?.id == owner)
                    assertTrue("The verification must leave no pending operations", database.dao().pendingSize(owner) == 0)
                    assertTrue("The repository must not be synchronizing during this read-only check", !repository.account.value.syncing)
                }
            }
        } catch (assertion: AssertionError) {
            throw assertion
        } catch (_: Exception) {
            // Network/JSON exception messages may contain a request URL or user collection; do not expose them.
            throw AssertionError("Read-only live account verification failed during $stage")
        }
    }
}
