package xyz.hahaen.radio.graphics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import xyz.hahaen.radio.app.theme.*
import xyz.hahaen.radio.domain.Station
import kotlin.math.*

/** A native, non-animated fallback; it does not depend on a live WebView or network. */
@Composable fun StaticRadioScene(immersive: Boolean, scene: String, station: Station?) {
    val context = LocalContext.current.applicationContext
    val land by produceState<List<Offset>>(emptyList(), context) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                context.assets.open("graphics/geography/land.json").bufferedReader().use { reader ->
                    val points = JSONObject(reader.readText()).getJSONArray("points")
                    buildList {
                        for (index in 0 until minOf(points.length(), 20_000)) {
                            val point = points.getJSONArray(index)
                            project(point.getDouble(0), point.getDouble(1))?.let(::add)
                        }
                    }
                }
            }.getOrDefault(emptyList())
        }
    }
    val selected = remember(station?.latitude, station?.longitude) {
        station?.let { value -> value.longitude?.let { lon -> value.latitude?.let { lat -> project(lon, lat) } } }
    }
    Canvas(Modifier.fillMaxSize()) {
        drawRect(Ink)
        if (!immersive) {
            val radius = min(size.width * .4f, size.height * .27f)
            val origin = Offset(size.width / 2, size.height * if (size.height >= size.width) .42f else .33f)
            drawCircle(Brush.radialGradient(listOf(Surface.copy(alpha = .65f), Ink), origin, radius * 1.25f), radius * 1.25f, origin)
            drawCircle(Brush.radialGradient(listOf(Surface, Ink), origin - Offset(radius * .3f, radius * .3f), radius * 1.5f), radius, origin)
            land.forEach { point ->
                val depth = sqrt((1 - point.x * point.x - point.y * point.y).coerceAtLeast(0f))
                drawCircle(SeaGlass.copy(alpha = .12f + depth * .2f), maxOf(.65.dp.toPx(), radius / 220), origin + point * radius)
            }
            drawCircle(SeaGlass.copy(alpha = .2f), radius, origin, style = Stroke(1.dp.toPx()))
            selected?.let { point ->
                val location = origin + point * radius
                drawCircle(Coral.copy(alpha = .12f), 12.dp.toPx(), location)
                drawCircle(Coral, 4.dp.toPx(), location, style = Stroke(1.2.dp.toPx()))
                if (station?.locationPrecision == "coordinates") drawCircle(Coral, 1.6.dp.toPx(), location)
            }
        } else {
            val horizon = size.height * .45f
            drawRect(Brush.verticalGradient(listOf(Ink, Surface, Ink)))
            if (scene == "aurora") {
                val ribbon = Path().apply {
                    moveTo(-size.width * .1f, horizon)
                    cubicTo(size.width * .25f, horizon * .1f, size.width * .55f, horizon * 1.5f, size.width * 1.1f, horizon * .3f)
                    lineTo(size.width * 1.1f, horizon * .8f)
                    cubicTo(size.width * .55f, horizon * 1.8f, size.width * .25f, horizon * .35f, -size.width * .1f, horizon * 1.3f)
                    close()
                }
                drawPath(ribbon, Brush.verticalGradient(listOf(Color.Transparent, SeaGlass.copy(alpha = .16f), Color.Transparent)))
            } else {
                repeat(5) { layer ->
                    val y = horizon + layer * size.height * .065f
                    val wave = Path().apply {
                        moveTo(0f, y)
                        if (scene == "mountains") {
                            lineTo(size.width * .2f, y - size.height * .1f)
                            lineTo(size.width * .48f, y - size.height * .035f)
                            lineTo(size.width * .72f, y - size.height * .14f)
                            lineTo(size.width, y - size.height * .04f)
                        } else cubicTo(size.width * .32f, y - 26.dp.toPx(), size.width * .6f, y + 30.dp.toPx(), size.width, y - 8.dp.toPx())
                        lineTo(size.width, size.height)
                        lineTo(0f, size.height)
                        close()
                    }
                    drawPath(wave, if (layer % 2 == 0) SeaGlass.copy(alpha = .07f) else Ink.copy(alpha = .3f))
                }
            }
        }
    }
}

private fun project(longitude: Double, latitude: Double): Offset? {
    if (!longitude.isFinite() || !latitude.isFinite() || longitude !in -180.0..180.0 || latitude !in -90.0..90.0) return null
    val lat = Math.toRadians(latitude)
    val delta = Math.toRadians(longitude - 90)
    val centerLat = Math.toRadians(25.0)
    val depth = sin(centerLat) * sin(lat) + cos(centerLat) * cos(lat) * cos(delta)
    if (depth < 0) return null
    return Offset((cos(lat) * sin(delta)).toFloat(), -(cos(centerLat) * sin(lat) - sin(centerLat) * cos(lat) * cos(delta)).toFloat())
}
