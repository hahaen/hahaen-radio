package xyz.hahaen.radio.feature

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import android.view.inputmethod.InputMethodManager
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlin.math.PI
import kotlin.math.sin
import kotlinx.coroutines.flow.collectLatest
import xyz.hahaen.radio.R
import xyz.hahaen.radio.app.theme.*

@Composable internal fun NightOverflowColumn(
    modifier: Modifier = Modifier,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
    content: @Composable ColumnScope.() -> Unit,
) {
    val scroll = rememberScrollState()
    var contentHeight by remember { mutableIntStateOf(0) }
    BoxWithConstraints(modifier.clipToBounds()) {
        val overflows = constraints.hasBoundedHeight && contentHeight > constraints.maxHeight
        LaunchedEffect(overflows) { if (!overflows) scroll.scrollTo(0) }
        Column(
            Modifier.fillMaxWidth()
                // A disabled scroll modifier still participates in hit testing. Omit it entirely
                // when the content fits so touches on text and empty space reach the scene.
                .then(if (overflows) Modifier.verticalScroll(scroll) else Modifier)
                .wrapContentHeight(align = Alignment.Top, unbounded = true)
                .onSizeChanged { contentHeight = it.height },
            horizontalAlignment = horizontalAlignment,
            content = content,
        )
    }
}

@Composable internal fun NightField(
    value: String,
    onValueChange: (String) -> Unit,
    label: Int,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val interactions = remember { MutableInteractionSource() }
    var focused by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(interactions, keyboard, view, lifecycle) {
        interactions.interactions.collectLatest { interaction ->
            if (interaction is FocusInteraction.Focus || interaction is PressInteraction.Release) {
                withFrameNanos { }
                fun canShow() = focused && view.hasWindowFocus() &&
                    lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
                if (canShow()) {
                    if (interaction is PressInteraction.Release) {
                        // Match TextView's tap notification: some IMEs use it to leave hardware mode.
                        @Suppress("DEPRECATION")
                        view.context.getSystemService(InputMethodManager::class.java).viewClicked(view)
                    }
                    keyboard?.show()
                }
            }
        }
    }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(stringResource(label)) },
        modifier = modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
        interactionSource = interactions,
        singleLine = true,
        shape = RoundedCornerShape(10.dp),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = Warm),
        leadingIcon = leadingIcon?.let { icon -> { Icon(icon, null, tint = Muted, modifier = Modifier.size(20.dp)) } },
        trailingIcon = trailingIcon,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = Warm, unfocusedTextColor = Warm,
            focusedContainerColor = Panel, unfocusedContainerColor = Panel,
            focusedBorderColor = SeaGlass, unfocusedBorderColor = Border,
            focusedLabelColor = Muted, unfocusedLabelColor = Muted,
            cursorColor = Warm,
        ),
    )
}

@Composable internal fun NightPill(label: String, selected: Boolean, action: () -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true) {
    FilterChip(
        selected = selected,
        enabled = enabled,
        onClick = action,
        label = { Text(label, style = MaterialTheme.typography.labelLarge) },
        modifier = modifier.heightIn(min = 48.dp),
        shape = CircleShape,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = Color.Transparent, labelColor = Muted,
            selectedContainerColor = Surface, selectedLabelColor = Warm,
        ),
        border = BorderStroke(1.dp, if (selected) SeaGlass.copy(alpha = .65f) else Border),
    )
}

@Composable internal fun NightStationMark() {
    Box(Modifier.size(40.dp).clip(CircleShape).background(Surface)
        .border(1.dp, SeaGlass.copy(alpha = .2f), CircleShape), contentAlignment = Alignment.Center) {
        Image(painterResource(R.drawable.ic_launcher_artwork), contentDescription = null,
            modifier = Modifier.size(36.dp))
    }
}

@Composable internal fun NightSignal(playing: Boolean, motionAllowed: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val powerManager = remember(context) { context.getSystemService(PowerManager::class.java) }
    var systemPowerSave by remember(powerManager) { mutableStateOf(powerManager.isPowerSaveMode) }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    DisposableEffect(context, powerManager) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                systemPowerSave = powerManager.isPowerSaveMode
            }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED)
        systemPowerSave = powerManager.isPowerSaveMode
        onDispose { context.unregisterReceiver(receiver) }
    }
    val phase = if (playing && motionAllowed && !systemPowerSave && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)) {
        rememberInfiniteTransition(label = "listening signal").animateFloat(
            initialValue = 0f, targetValue = (2 * PI).toFloat(),
            animationSpec = infiniteRepeatable(tween(1440, easing = LinearEasing)), label = "signal phase")
    } else null
    Canvas(modifier.size(15.dp)) {
        // Read animated state only while drawing; no layout or page recomposition per frame.
        val angle = phase?.value
        val stroke = 2.dp.toPx()
        repeat(3) { index ->
            val height = when {
                !playing -> .12f
                angle != null -> .3f + .65f * (.5f + .5f * sin(angle + index * 2.1f))
                index == 0 -> .45f
                index == 1 -> .9f
                else -> .65f
            }
            val x = size.width * (.18f + index * .32f)
            val half = (size.height - stroke).coerceAtLeast(0f) * height / 2
            drawLine(if (playing) Coral else Muted, Offset(x, center.y - half), Offset(x, center.y + half),
                stroke, StrokeCap.Round)
        }
    }
}

@Composable internal fun NightEmptyState(description: Int, icon: ImageVector, actionLabel: Int? = null, action: (() -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(68.dp).border(1.dp, Border, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(28.dp), tint = SeaGlass)
        }
        Text(stringResource(R.string.empty), style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
        Text(stringResource(description), color = Muted, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        if (actionLabel != null && action != null) {
            TextButton(onClick = action, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(actionLabel), color = Warm) }
        }
    }
}

@Composable internal fun NightLoading(label: Int) {
    Row(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 1.5.dp, color = SeaGlass)
        Text(stringResource(label), Modifier.padding(start = 12.dp), color = Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable internal fun NightNotice(icon: ImageVector, text: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Panel).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, Modifier.padding(top = 2.dp).size(18.dp), tint = SeaGlass)
        Text(text, color = Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable internal fun NightDialog(
    title: Int,
    description: Int? = null,
    confirm: () -> Unit,
    dismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = dismiss,
        containerColor = Panel,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.border(1.dp, Border, RoundedCornerShape(16.dp)),
        title = { Text(stringResource(title), style = MaterialTheme.typography.titleLarge) },
        text = description?.let { resource -> { Text(stringResource(resource), color = Muted) } },
        confirmButton = { TextButton(onClick = confirm, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.confirm)) } },
        dismissButton = { TextButton(onClick = dismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel), color = Muted) } },
    )
}
