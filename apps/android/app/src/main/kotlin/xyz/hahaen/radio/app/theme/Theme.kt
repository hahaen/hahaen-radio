package xyz.hahaen.radio.app.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import xyz.hahaen.radio.R

val Ink = Color(0xFF081310)
val Surface = Color(0xFF142923)
val Warm = Color(0xFFF5F1E8)
val Muted = Color(0xFFB3C1B7)
val Coral = Color(0xFFF36B45)
val SeaGlass = Color(0xFF91AAA0)
val Panel = Color(0xFF0E1E19)
val Border = Warm.copy(alpha = .12f)
val DisplayFont = FontFamily(Font(R.font.noto_serif_sc_ui))
val BodyFont = FontFamily(Font(R.font.inter_ui))
val MonoFont = FontFamily(Font(R.font.jetbrains_mono_ui))

@Composable fun HaenTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Coral, onPrimary = Ink,
        background = Ink, onBackground = Warm, surface = Surface, onSurface = Warm,
        surfaceVariant = Panel, onSurfaceVariant = Muted, secondary = SeaGlass,
        onSecondary = Ink, secondaryContainer = Surface, onSecondaryContainer = Warm,
        primaryContainer = Surface, onPrimaryContainer = Warm,
        surfaceContainerLowest = Ink, surfaceContainerLow = Panel,
        surfaceContainer = Panel, surfaceContainerHigh = Surface,
        surfaceContainerHighest = Surface, surfaceTint = Color.Transparent,
        outline = SeaGlass, outlineVariant = Border,
        error = Color(0xFFF2AC99), onError = Ink),
        typography = Typography(
            headlineLarge = TextStyle(fontFamily = DisplayFont, fontSize = 34.sp, lineHeight = 44.sp),
            headlineMedium = TextStyle(fontFamily = DisplayFont, fontSize = 28.sp, lineHeight = 38.sp),
            titleLarge = TextStyle(fontFamily = BodyFont, fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium),
            titleMedium = TextStyle(fontFamily = BodyFont, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium),
            bodyLarge = TextStyle(fontFamily = BodyFont, fontSize = 16.sp, lineHeight = 24.sp),
            bodyMedium = TextStyle(fontFamily = BodyFont, fontSize = 14.sp, lineHeight = 21.sp),
            bodySmall = TextStyle(fontFamily = BodyFont, fontSize = 12.sp, lineHeight = 18.sp),
            labelLarge = TextStyle(fontFamily = BodyFont, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
            labelMedium = TextStyle(fontFamily = BodyFont, fontSize = 12.sp, lineHeight = 18.sp),
            labelSmall = TextStyle(fontFamily = BodyFont, fontSize = 11.sp, lineHeight = 16.sp),
        ),
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(20.dp), extraLarge = RoundedCornerShape(24.dp)),
        content = content)
}
