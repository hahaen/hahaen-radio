package xyz.hahaen.radio.data.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import retrofit2.http.*
import xyz.hahaen.radio.domain.*

@Serializable data class StationDto(
    val id: String, val name: String, val countryCode: String? = null,
    val region: String? = null, val city: String? = null, val nearbyCity: String? = null,
    val latitude: Double? = null, val longitude: Double? = null,
    val locationPrecision: String = "unknown", val genre: String = "general",
    val languages: List<String> = emptyList(), val bitrate: Int? = null,
    val availability: String = "unknown", val streams: List<StreamDto> = emptyList(),
) {
    fun model() = Station(id, name, countryCode, region, city, nearbyCity, latitude, longitude,
        locationPrecision, genre, languages, bitrate, availability)
}
@Serializable data class StreamDto(val id: String, val url: String, val hls: Boolean = false)
@Serializable data class StationPage(val items: List<StationDto>, val total: Int, val offset: Int, val limit: Int)
@Serializable data class CountDto(val id: String, val count: Int)
@Serializable data class ChunkRef(val index: Int, val count: Int)
@Serializable data class ManifestDto(val version: String, val stationCount: Int, val playableCount: Int,
    val countryCount: Int, val genres: List<CountDto>, val languages: List<CountDto>, val chunks: List<ChunkRef>,
    val format: Int? = null, val restrictionsRevision: String? = null)
@Serializable data class ChunkDto(val version: String, val index: Int, val items: List<StationDto>)
@Serializable data class SceneChunkDto(val format: Int, val version: String, val index: Int,
    val restrictionsRevision: String, val entries: List<JsonArray>)
@Serializable data class StationLookup(val ids: List<String>)
@Serializable data class StationLookupResult(val items: List<StationDto>, val missing: List<String>)
@Serializable data class SessionDto(val user: AccountUser?)
@Serializable data class Credentials(val username: String, val password: String)
@Serializable data class Owner(val userId: String)
@Serializable data class SaveLibrary(val userId: String, val revision: Int, val collection: ListeningCollection)

interface RadioApi {
    @GET("stations") suspend fun stations(@Query("q") q: String = "", @Query("genres") genres: String? = null,
        @Query("languages") languages: String? = null, @Query("minBitrate") bitrate: Int = 0,
        @Query("offset") offset: Int = 0, @Query("limit") limit: Int = 30,
        @Query("playableOnly") playable: Boolean = true, @Query("excludeIds") excludeIds: String? = null): StationPage
    @POST("stations/lookup") suspend fun lookup(@Body body: StationLookup): StationLookupResult
    @GET("stations/{id}") suspend fun station(@Path("id") id: String): StationDto
    @GET("catalog") suspend fun manifest(): ManifestDto
    @GET("catalog/scene") suspend fun sceneManifest(): ManifestDto
    @GET("catalog/scene/{version}/chunks/{index}") suspend fun sceneChunk(@Path("version") version: String, @Path("index") index: Int): SceneChunkDto
    @GET("catalog/{version}/chunks/{index}") suspend fun chunk(@Path("version") version: String, @Path("index") index: Int): ChunkDto
    @GET("account/session") suspend fun session(): SessionDto
    @POST("account/login") suspend fun login(@Body credentials: Credentials): SessionDto
    @POST("account/logout") suspend fun logout(@Body owner: Owner): SessionDto
    @GET("account/library") suspend fun library(@Query("userId") userId: String): Library
    @POST("account/library") suspend fun saveLibrary(@Body body: SaveLibrary): Library
}
