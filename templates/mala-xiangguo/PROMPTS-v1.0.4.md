# v1.0.4 配料抓取素材

使用内置 ImageGen 生成芝麻散料。采用第一版输出，保留原 PNG 的透明通道；屏幕拖拽截图验证没有料碗和背景。葱花与香菜沿用之前生成的独立散料图。

项目素材：`assets/portion_sesame.png`、`assets/portion_scallions.png`、`assets/portion_cilantro.png`。芝麻兼容素材另存为 `public/noodle/assets/portion-sesame.png`。三份散料内嵌到 `artifacts/麻辣香锅-v1.0.4.luobo`。

## 采用的生成提示词

Use case: illustration-story. Asset type: a transparent PNG ingredient pickup sprite for an existing Chinese mala xiangguo cooking game. Subject: ONE small loose pinch / compact pile of toasted WHITE SESAME SEEDS, roughly 60 clearly visible tiny ivory and pale golden sesame seeds, with a few individual seeds just outside the main pile. Hand-painted semi-realistic cooking-game illustration, warm clean material shading, crisp shapes that remain readable when scaled to 60 pixels. Strict front-facing level view, no tilted camera, not isometric. Centered compact landscape silhouette with generous clear alpha padding, every seed fully inside the image. The ingredient itself is the entire subject. TRUE TRANSPARENT alpha background. NO BOWL, no container, no plate, no tray, no spoon, no hands, no food dish, no table, no scenery, no text, no logo, no watermark.

## 比较过的编辑提示词（未采用）

Use case: precise-object-edit / background-extraction. Edit this sesame game sprite. KEEP the individual sesame seeds, their colors, material, hand-painted style and compact heap composition. REMOVE ALL the diffuse GOLD GLOW, surrounding HAZE, colored halo, gradients, background illumination, and any outer shadow COMPLETELY. The cutout must contain ONLY hard, clean-edged visible sesame seeds. Every gap between seeds and every pixel outside the actual sesame silhouettes must be fully transparent clear alpha. NO ambient glow or underlay, NO drop shadow, NO fog, NO black or white matte. Do not add a bowl, plate, spoon, hands, container, tabletop, text, or any other object. It must match a clean isolated ingredient PNG for a drag-and-drop cooking game.
