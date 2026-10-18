# 图标候选生成提示词

## C · 透明背景修正

生成方式：内置 image_gen 编辑，开启真正透明背景；先提取背景，再进行边缘清理。

```text
Use case: background-extraction. Image 1 is the edit target: the approved HAEN favicon. Remove ONLY the entire dark navy background and replace it with genuine fully transparent alpha everywhere, including all open spaces inside the headphones and between the amber circle and seafoam wave. Preserve the exact existing headphone silhouette, ear pads, amber circle, wave shape, positions, scale, generous padding, original canvas proportions, and original ivory / muted seafoam / amber foreground colors. Do not redesign, redraw, stylize, or add anything. Keep all foreground elements fully opaque with clean antialiased edges and no dark matte fringe. Do not add shadows or glow. No solid black, navy, white, gray, or checkerboard background: actual RGBA transparency. Output one square transparent PNG icon with the original composition unchanged.
```

```text
Precise cleanup edit of this transparent HAEN headphone icon. The subject has three clean opaque components: one continuous ivory headphone arch joined to both ivory ear pads, one amber filled circle, and one seafoam filled wave. Keep their existing shape, arrangement, color and proportions. Fix the current extraction artifacts: remove EVERY stray white speck, isolated pixel cluster, colored fringe and rough halo floating in the transparent spaces or along the contour. Clean the edges into smooth crisp antialiased silhouettes, like a carefully prepared vector logo. Areas between the three components and outside the icon must be completely empty genuine alpha=0 transparency. Keep the icon flat, no shadows, no outer outline, no added backdrop, no added checkerboard, no texture. Output one clean RGBA transparent PNG with the same square composition. Preserve the headphones, seafoam wave, amber circle and padding.
```

以下为初始候选的生成记录：使用内置 image_gen，每款独立生成一张 PNG，用于方案选择。

## A · 声波岛屿

```text
Use case: logo-brand. Create ONE professional favicon concept for the Chinese global internet radio brand 声屿 HAEN, whose feeling is quiet listening and exploring the world at night. Deliver a single centered crisp flat graphic, square canvas, solid deep sea ink background #0B151B reaching every edge. Symbol fills about 78% of the width, generous even padding. Palette limited to warm ivory #E8E9E1, muted seafoam #83AAA3, and a small warm amber #D8AD6B accent. High contrast, thick confident geometric forms, carefully balanced negative space. Must remain recognizable reduced to 16x16 and 32x32. No words, no tagline, no labels, no border frame, no mockup, no drop shadow, no gradient, no glow, no texture, no hairlines, no tiny detail, no photorealism, no 3D. This is a new original visual identity; only output the single icon. Design direction A: SOUND ISLAND. An original compact emblem with three chunky softly rounded vertical pillars of differing heights (middle tallest), whose bases merge into a single broad curved muted seafoam wave like an island floating at sea. Pillars in warm ivory. A small amber sun-like dot at upper right, integrated and large enough to survive at small size. Sophisticated minimal abstract symbol conveying audio, island and ocean; asymmetric elegant composition, avoid resembling a standard bar chart.
```

## B · 环游地球

```text
Use case: logo-brand. Create ONE professional favicon concept for the Chinese global internet radio brand 声屿 HAEN, whose feeling is quiet listening and exploring the world at night. Deliver a single centered crisp flat graphic, square canvas, solid deep sea ink background #0B151B reaching every edge. Symbol fills about 78% of the width, generous even padding. Palette limited to warm ivory #E8E9E1, muted seafoam #83AAA3, and a small warm amber #D8AD6B accent. High contrast, thick confident geometric forms, carefully balanced negative space. Must remain recognizable reduced to 16x16 and 32x32. No words, no tagline, no labels, no border frame, no mockup, no drop shadow, no gradient, no glow, no texture, no hairlines, no tiny detail, no photorealism, no 3D. This is a new original visual identity; only output the single icon. Design direction B: WORLD RADIO. A bold warm-ivory circular planet ring with only one thick curved muted seafoam meridian inside and one broad crossing amber orbital swoosh. The orbit implies a radio signal traveling around the globe. Extremely simplified globe abstraction, no continents, no grid, no satellite, no stars, no extra details. Distinctive continuous silhouette; orbit crosses near lower right. Keep every stroke substantial at favicon scale.
```

## C · 耳机海湾

```text
Use case: logo-brand. Create ONE professional favicon concept for the Chinese global internet radio brand 声屿 HAEN, whose feeling is quiet listening and exploring the world at night. Deliver a single centered crisp flat graphic, square canvas, solid deep sea ink background #0B151B reaching every edge. Symbol fills about 78% of the width, generous even padding. Palette limited to warm ivory #E8E9E1, muted seafoam #83AAA3, and a small warm amber #D8AD6B accent. High contrast, thick confident geometric forms, carefully balanced negative space. Must remain recognizable reduced to 16x16 and 32x32. No words, no tagline, no labels, no border frame, no mockup, no drop shadow, no gradient, no glow, no texture, no hairlines, no tiny detail, no photorealism, no 3D. This is a new original visual identity; only output the single icon. Design direction C: LISTENING BAY. A thick warm-ivory headphone arch with two chunky rounded ear pads; inside the headphones a very simple muted seafoam island/ocean shape formed by a single wide upward-curving wave, with one substantial amber dot above the wave. Compact round silhouette, cozy calm feeling, premium mature brand rather than cartoon face. No eyes or mouth. Broad openings and low element count, all pieces easy to recognize at 16px.
```

## D · HAEN 字母标

```text
Use case: logo-brand. Create ONE professional favicon concept for the Chinese global internet radio brand 声屿 HAEN, whose feeling is quiet listening and exploring the world at night. Deliver a single centered crisp flat graphic, square canvas, solid deep sea ink background #0B151B reaching every edge. Symbol fills about 78% of the width, generous even padding. Palette limited to warm ivory #E8E9E1, muted seafoam #83AAA3, and a small warm amber #D8AD6B accent. High contrast, thick confident geometric forms, carefully balanced negative space. Must remain recognizable reduced to 16x16 and 32x32. No words, no tagline, no labels, no border frame, no mockup, no drop shadow, no gradient, no glow, no texture, no hairlines, no tiny detail, no photorealism, no 3D. This is a new original visual identity; only output the single icon. Design direction D: HAEN MONOGRAM. One confident custom capital H monogram as a unified geometric brandmark, made of two broad warm-ivory vertical stems joined by a single broad muted seafoam curved crossbar suggesting an ocean wave or sound traveling. A small but substantial amber circular accent nestled at the top right of the right stem. Only the H-shaped symbol, no other letters. Rounded internal corners but precise silhouette; wide stems, open negative space. Warm restrained modern identity, distinctive at 16px.
```
