# RESEARCH-13a — `Yytsi/floorplan-to-3d` 几何挤出法调研

> 调研对象：GitHub [`Yytsi/floorplan-to-3d`](https://github.com/Yytsi/floorplan-to-3d) + HuggingFace [`Yytsi/floorplan-to-3d-walls`](https://huggingface.co/Yytsi/floorplan-to-3d-walls)  
> 调研日期：2026-11-02  
> 性质：只读调研；未改项目代码。  
> 结论先行：**架构值得借鉴，但不是 INT-13 的即插即用替代品；最高价值是“结构真值 + 几何渲染”，不是“又一个生图模型”。**

---

## 0. 结论摘要（给架构师）

| 判断 | 结论 |
|---|---|
| 能否解决“窗户数量错误” | **能，但有前提**：需要把 window 多边形按“窗单元”合并；仓库 viewer 只统计多边形数，不等于真实窗数 |
| 能否解决“房间比例缩水” | **能保留 2D 比例**；但仓库把最长边归一化到 8 个世界单位，**没有绝对米制尺度**，层高/尺寸仍需外部锚点 |
| 能否直接替换当前 Qwen+Seedream | **不建议**。输入是 CubiCasa SVG，不是 TG 的 JPG；模型在 Nordic CAD 分布上训练，0.983 mIoU 不能直接迁移到中国户型/红笔批注 |
| 最适合的角色 | **结构控制器/验证器/几何底图渲染器**，Seedream 继续负责材质与摄影感 |
| 最大风险 | ① 输入域不匹配；② `svg_render` 会主动删掉家具/尺寸/文字（与当前“最小干预”相反）；③ 窗户多边形 ≠ 窗单元；④ 无绝对尺度、无箭头机位 |
| 建议路线 | **P0 离线基准 → Path B 结构校验（低风险）→ Path A 几何底图 + Seedream（推荐）→ Path C 纯几何终稿（高保真兜底）** |

---

## 1. 技术架构拆解

### 1.1 数据与预处理（CubiCasa5K）

来源：[`data.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/data.py)、[`labels.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/labels.py)、[`svg_render.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/svg_render.py)、[`configs/default.yaml`](https://github.com/Yytsi/floorplan-to-3d/blob/main/configs/default.yaml)

- 数据：CubiCasa5K，四类语义：`floor / wall / door / window`。
- 类别优先级：`Window > Door > Wall`；绘制顺序 `wall → door → window`，后画的覆盖先画的。门/窗是墙上的“开口”，所以门窗覆盖墙是符合建筑语义的。
- 输入不是 F1_*.png，而是把 `model.svg` 用 **cairosvg** 栅格化，保证图像和 mask 同一坐标系。
- **关键预处理：`svg_render.filtered_svg_bytes()` 会在渲染前删掉非结构子树**：
  - 家具：`FixedFurniture`、`FixedFurnitureSet`
  - 五金/排水：`Faucet`、`Hanger`、`Railing`、`InnerDrain`、`OuterDrain`、`OuterCircle`
  - 标注：`Dimension`、`DimensionMark`、`Direction`、`TextLabel`、`Name`、`SpaceDimensionsLabel`
  - 杂项：`electricitySign`
- 这样做的原因写在源码注释里：家具细线会被模型误判为墙，导致 wall IoU 下降；训练标签里这些内容本来就是 `floor`。
- **这与 INT-13 的“最小干预，保留家具/尺寸线”直接冲突**：几何分割需要“结构-only”输入；比例参考需要“原始图纸”。因此集成时必须拆成两条产物：  
  `structure_input`（去家具/尺寸/文字，供分割） + `original_reference`（保留全部，供尺度/人工对照）。
- Letterbox：
  ```python
  scale = min(W / svg_w, H / svg_h)
  inner_w = round(svg_w * scale)
  inner_h = round(svg_h * scale)
  # 渲染 inner_w×inner_h，再居中 pad 到 512×512
  # 图像 pad 用 ImageNet mean（归一化后为 0），mask pad 用 floor
  ```
  - 好处：非方形户型不被拉伸。
  - 代价：512×512 下，长细墙可能变成亚像素；模型卡也明确提示“very long thin walls can get sub-pixel and be missed”。
- 归一化：ImageNet mean/std；训练/推理一致。

### 1.2 分割模型

来源：[`model.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/model.py)、[`train.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/train.py)

```python
return smp.Unet(
    encoder_name="resnet34",
    encoder_weights="imagenet",
    in_channels=3,
    classes=4,
)
```

- 架构：**UNet + ResNet-34 encoder**（`segmentation-models-pytorch`），ImageNet 预训练，输出 4 类 raw logits。
- 输入：`3×512×512`；输出：`4×512×512`，`argmax` 得类别 mask。
- 训练：
  - Loss：CrossEntropyLoss
  - Optimizer：AdamW，`lr=1e-3`，`weight_decay=1e-4`
  - Batch：8；Epochs：30；`num_workers=4`
  - Device：auto（cuda → mps → cpu）；推理 CPU 可跑，GPU 非必需。
  - 保存 `best.pt` / `last.pt` / `metrics.csv` / `train.log`。
- 指标：HF 模型卡给出 **val mIoU 0.983 @ epoch 26**（4 类平均）。
  - 注意：这是 CubiCasa5K 同分布验证集，不是中国 CAD/TG 截图；不能拿这个数直接承诺线上效果。
- 训练数据限制（模型卡原文）：
  - CubiCasa5K 以 Nordic residential plans 为主，CAD 风格单一；
  - 手绘草图、商业蓝图、不同线 convention 可能漏；
  - 只预测四类结构；家具/设备/文字都归 floor；
  - 超长细墙在 512 下可能漏。

### 1.3 多边形提取

来源：[`extract_polygons.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/extract_polygons.py)

每个类（wall/door/window）独立走同一条流水线：

```python
binary = (mask == class_id).astype(np.uint8)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

contours, hierarchy = cv2.findContours(
    closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
# hierarchy = [next, prev, child, parent]；CCOMP 只保留 outer + 一级 holes

simplified = cv2.approxPolyDP(contour, 1.5, closed=True)
# outer area < 30 px² 丢弃（模型噪点）
```

- **morphological closing 3×3**：补 1px 断点，让“断开的墙”成为一个多边形，而不是两个。
- **RETR_CCOMP**：取出 outer contour 和一级 hole；墙环 + 门洞正好是“一个 outer + 一个 hole”。
- **Douglas–Peucker epsilon=1.5px**：消除像素阶梯；轴对齐墙从几十个共线点压到两个点；斜墙不会明显变形。
- **MIN_POLYGON_AREA_PX=30**：512 下真实门约 80px²、窗约 150px²，30 是安全下限；小于它的当模型 speckle 丢弃。
- 输出结构：
  ```json
  {
    "canvas_size": [W, H],
    "content_rect": [left, top, inner_w, inner_h],
    "polygons": {
      "wall": [{"outer": [[x,y],...], "holes": [[[x,y],...]]}],
      "door": [...],
      "window": [...]
    }
  }
  ```
- `floor` 不提取：它是负空间，viewer 直接用一个地面平面表示。
- **重要限制**：`window` 多边形是“语义窗像素的连通域”，不是“窗单元”。一扇带中挺/分格的落地窗可能产生多个 polygon；viewer 的 `summarize()` 只是 `data.polygons.window.length`，它统计的是**多边形数**，不是真实窗数。要做“窗数 QC”，必须额外做邻近合并/按墙段分组。

### 1.4 3D 挤出与 Three.js 渲染

来源：[`viewer/index.html`](https://github.com/Yytsi/floorplan-to-3d/blob/main/viewer/index.html)

核心常量：

```js
const TARGET_PLAN_SIZE = 8.0;   // 最长边归一化到 8 世界单位
const WALL_HEIGHT      = 0.55;
const DOOR_HEIGHT      = 0.40;  // ~75% 墙高
const WINDOW_SILL      = 0.16;
const WINDOW_TOP       = 0.45;
const RISE_DURATION_MS = 900;
const STAGGER_MS       = 28;
const EDGE_ANGLE_DEG   = 14;
```

流程：

1. 用 `polygonsBBox()` 求所有 wall/door/window 的 bbox；
2. `scale = TARGET_PLAN_SIZE / max(bw, bh)`，以 bbox 中心为世界原点；
3. 每个 polygon 用 `THREE.Shape` 画 outer，`shape.holes.push()` 挖洞；
4. `THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })`；
5. `mesh.rotation.x = -Math.PI / 2`，把局部 Z 变成世界 Y（向上）；
6. 高度：
   - wall：`depth=WALL_HEIGHT`，从 `y=0` 起；
   - door：`depth=DOOR_HEIGHT`，从 `y=0` 起（矮体块，表示门洞）；
   - window：`depth=WINDOW_TOP-WINDOW_SILL`，`mesh.position.y=WINDOW_SILL`，形成窗台到窗顶的玻璃板；
7. 材质：白墙/白门 `MeshStandardMaterial`，窗 `MeshPhysicalMaterial`（半透明玻璃），黑线 `EdgesGeometry`；
8. 相机：`PerspectiveCamera(34°)`，固定等轴测方向 `(0.55, 0.62, 0.85)`，OrbitControls；
9. 动画：按 polygon 质心到平面中心的距离排序，逐个小体块“升起”。

**关键评价**：

- 几何挤出本身是可靠的：outer + holes + 高度分层，正好对应“墙/门洞/窗洞”。
- 但 viewer 是**浏览器端展示器**，不是服务端渲染器；相机是固定的 orbit 视角，**没有“箭头起点→终点”的机位 API**。
- 世界单位是任意的，`TARGET_PLAN_SIZE=8` 只保留比例，不保留米制；层高 3m、视高 1.6m 需要额外映射。
- 窗是“玻璃板”，不是“墙洞 + 窗框”；白膜输出如果要“窗洞”，需要自己切 wall opening，而不是只叠玻璃板。

### 1.5 推理服务

来源：[`server/main.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/server/main.py)

- FastAPI；启动时加载一次 `PolygonExtractor`；`/healthz`、`/sample/{key}`、`/extract`。
- `/extract` **只接受 SVG**（`UploadFile`），上限 16MB；内部写临时 `.svg`，走 `PolygonExtractor.extract()`。
- 返回 `canvas_size`、`content_rect`、`polygons`，并附加 `input_image_b64` 给 viewer 当地面贴图。
- 没有 JPG/PNG 入口；没有“栅格图 → SVG”转换；没有相机参数入口。

---

## 2. 提示词/约束词提取

### 2.1 先给结论：这个仓库没有提示词

我在仓库树、README、server、viewer、训练/推理代码中未发现：

- Stable Diffusion / Flux / Seedream 的 **正向 prompt**；
- **negative prompt**；
- **Canny / MLSD** 阈值；
- **LoRA trigger word**；
- 任何 `prompt`、`negative_prompt`、`canny`、`mlsd`、`lora` 配置。

它是一个 **纯 CV 分割 + 多边形 + Three.js** 项目，不是扩散模型项目。  
因此下面分两层：

- **A. 仓库真实存在的“几何约束参数”**（可直接抄）；
- **B. 为 INT-13 推导的提示词/参数建议**（不是仓库原文，必须标“derived”）。

### 2.2 A. 仓库真实几何约束参数（可执行）

| 模块 | 参数 | 值 | 用途 |
|---|---|---|---|
| 数据 | image_size | 512×512 | 模型输入 |
| 数据 | letterbox | true | 保比例、中心 pad |
| 数据 | normalize | true | ImageNet mean/std |
| 数据 | classes | floor/wall/door/window | 4 类 |
| 数据 | paint_order | wall→door→window | 后覆盖前 |
| 模型 | encoder | resnet34 + ImageNet | UNet backbone |
| 训练 | loss | CrossEntropy | 4 类逐像素 |
| 训练 | optimizer | AdamW, lr 1e-3, wd 1e-4 | — |
| 训练 | batch/epochs | 8 / 30 | — |
| 多边形 | closing kernel | 3×3 | 补 1px 断墙 |
| 多边形 | contour mode | RETR_CCOMP | outer + 一级 holes |
| 多边形 | approx epsilon | 1.5 px | Douglas–Peucker |
| 多边形 | min polygon area | 30 px² | 去 speckle |
| 3D | wall height | 0.55 | 墙全高 |
| 3D | door height | 0.40 | 门矮体块 |
| 3D | window sill/top | 0.16 / 0.45 | 玻璃板高度 |
| 3D | target plan size | 8.0 | 最长边归一化 |
| 3D | camera fov | 34° | 透视 |
| 3D | edge angle | 14° | 折线显示 |
| 服务 | upload max | 16 MB | SVG only |

### 2.3 B. 为 INT-13 推导的白膜 Prompt（derived，不是仓库原文）

#### B1. 几何控制 + Seedream 参考图（推荐）

**Positive**

```text
Use the supplied white massing render as the exact structural reference.
Preserve every wall position, every window opening and every door opening,
the room aspect ratio and the ceiling height from that render.
Photorealistic white clay architectural maquette, orthogonal extruded prisms,
flat floor, matte untextured white/light-grey clay, soft ambient daylight,
ambient occlusion and contact shadows, clean edges, no loose furniture.
```

**Negative**

```text
furniture, sofa, rug, curtains, text, labels, dimension lines, red annotations,
extra windows, missing windows, extra doors, missing doors, curved walls,
wood, fabric, metal, glass tint, glossy reflections, cartoon, sketch,
watermark, distorted perspective, top-down view, fisheye, duplicate walls
```

#### B2. 纯几何终稿（Blender/Cycles clay）

**Positive**

```text
Architectural white massing model, exact geometry from the floor plan,
walls extruded to full height, door openings cut short, window openings cut
between sill and lintel, flat ceiling, flat floor, 1:1 plan proportions,
matte white clay, soft studio sky light, ambient occlusion, no furniture.
```

**Negative**

```text
furniture, text, red marks, dimension lines, decorative materials, wood,
fabric, metal, glass reflections, people, plants, rugs, artwork, clutter,
extra windows, extra doors, non-orthogonal walls, perspective distortion
```

#### B3. Qwen 结构 JSON（保留现有链路）

```json
{
  "arrow_head_side": "left|right|top|bottom",
  "arrow_tail_side": "left|right|top|bottom",
  "arrow_points_at": "label",
  "tv_wall_side": "top|bottom|left|right|unknown",
  "storage_wall_side": "top|bottom|left|right|unknown",
  "window_sides": ["left|right|top|bottom"],
  "door_sides": ["left|right|top|bottom"],
  "window_count_hint": 2,
  "confidence": 0.95
}
```

> 建议新增 `window_count_hint`，由几何分割给出，而不是让 Qwen 猜。

#### B4. 相机/开口约束（当前 INT-13 已在用）

```text
Camera at the {tail_edge} of the plan (arrow tail), at 1.6 m eye level,
looking toward the {head_edge} (arrow head), facing the label at the arrow tip.
Any open edge on the {tail_edge} is behind the camera and must not be rendered
as a solid wall blocking the view.
```

### 2.4 Canny / MLSD / LoRA 参数建议（derived；仓库无此层）

> 这些不是从仓库提取的；如果未来走 ControlNet 路线，只能作为**起测值**，必须用我们自己的图做 A/B。

| 参数 | 起测值 | 说明 |
|---|---|---|
| ControlNet Canny low | 100 | OpenCV 常用起点；按线稿粗细调 |
| ControlNet Canny high | 200 | 与 low 约 1:2 |
| ControlNet MLSD value threshold | 0.1 | 仅直线结构；起测 |
| ControlNet MLSD distance threshold | 0.1 | 起测 |
| ControlNet weight | 0.6–0.9 | 越高越锁结构，越低越自由 |
| ControlNet guidance | 5–7 | 与 weight 联动 |
| Steps / sampler | 25–30 / DPM++ 2M Karras | 常用起点 |
| Img2img strength（几何底图） | 0.45–0.65 | 太低不改风格，太高丢结构 |
| LoRA trigger（建议） | `white clay massing`, `architectural maquette` | **不是仓库词**；需自训/找现成 LoRA 验证 |
| LoRA weight | 0.6–0.8 | 起测 |

**结论：不要把这些数字写死进生产；它们只是实验起点。**

---

## 3. 与当前 INT-13 链路的对比

| 维度 | 当前 Qwen JSON + 纯线稿 + Seedream | 几何挤出法 |
|---|---|---|
| 结构真值 | 依赖 Qwen 语义 + Seedream 想象；会漂 | 分割 + 多边形 + 挤出；结构确定 |
| 窗户数量 | Prompt 不可靠；V-003/V-004 需人工盯 | 可由 window 类提取；但需按窗单元合并 |
| 房间比例 | 生成模型可能缩水/拉长 | 2D 比例保留；绝对米制仍需锚点 |
| 机位 | Qwen 箭头 + Prompt；语言控制 | 需显式相机 pose；viewer 默认固定 orbit |
| 风格/摄影感 | Seedream 强项 | Three.js/Blender clay 可控但不如生图“摄影” |
| 输入兼容 | JPG/PNG，TG 直接收 | 仓库只收 SVG；需矢量化或改推理入口 |
| 红笔/家具/尺寸 | 当前保留家具/尺寸，只抹红 | 仓库反而删家具/尺寸/文字（结构-only） |
| 领域适配 | 通用 VLM/生图，中文 CAD 可跑 | CubiCasa5K Nordic CAD；中国户型需验证/微调 |
| 成本/延迟 | Seedream ~120s/张（V-004 实测） | 分割 CPU 可跑；3D 渲染需 headless，另加时间 |
| 工程复杂度 | 低（现有链路） | 高（矢量化/分割/3D/相机/渲染） |
| 失败模式 | 窗数错、比例缩水、视角漂 | 分割漏墙、窗多边形碎、无尺度、SVG 域外 |

### 核心判断

- **几何挤出不是“更好的生图”，而是“结构真值生成器”**。
- 当前 INT-13 的痛点（窗数、比例、视角）正好是几何法的强项；但当前链路的强项（材质、摄影感、自然语言机位、JPG 输入）是几何法的弱项。
- 因此最佳组合不是二选一，而是：**几何负责“对不对”，Seedream 负责“好不好看”**。

---

## 4. 渐进式集成方案（2–3 条可落地路径）

### Path B（先做，2–4 天）：几何作为“结构校验器”

不引入 3D 渲染，只引入分割/多边形做 QC：

1. 对结构-only 底图跑分割（或先用 CubiCasa 样例验证）；
2. 提取：
   - `window` 多边形数 + 合并后的窗单元数；
   - `door` 多边形数；
   - wall bbox 的 `aspect_ratio = width/height`；
   - 墙段数量/总长（可选）。
3. 把 `window_count_hint`、`aspect_ratio` 注入 Qwen JSON / Prompt；
4. 出图后 QC：
   - 生成图的窗数（Qwen-VL 或边缘检测）是否等于 hint；
   - 生成图的房间 bbox 比例是否在 ±5%；
   - 不通过 → 重试/换 seed/回退。

**优点**：改动最小，不影响现有 Seedream 主链路；能直接减少“窗数错/比例缩水”投诉。  
**缺点**：分割域外时 hint 本身会错；不能解决视角；需要人工标注做基准。

### Path A（推荐，1–2 周）：几何底图 + Seedream 风格化

1. 原图 → 结构-only（去家具/尺寸/文字/红笔）→ 分割 → polygons；
2. 用 Three.js/Blender/trimesh 建 3D：
   - wall 全高、door 矮、window 窗台-窗顶；
   - 层高 3m、视高 1.6m、FOV 24mm；
   - 相机 pose 由箭头 `tail→head` 决定；
3. 从该相机渲染一张 **白模 clay 底图**（1306×2122）；
4. 把底图作为 Seedream 的 reference image（img2img / 参考图），低 strength + “preserve structure” prompt；
5. 出图后仍用几何 QC 校验窗数/比例。

**关键工程点**：
- 仓库 viewer 是浏览器端；服务端需要 **headless Chromium/Playwright** 截图，或把 polygons 导入 Blender/trimesh 渲染；
- 仓库的 `TARGET_PLAN_SIZE=8` 去掉了绝对尺度，需用 3m 层高/尺寸标注重建米制；
- 窗玻璃板不等于窗洞；白膜要“窗洞”，需在 wall polygon 上做布尔开口，或直接不渲染玻璃、只留洞；
- Seedream 的参考图强度需要 A/B；强度过高会“照抄线稿”，过低会丢结构。

**优点**：同时解决窗数/比例/视角；保留 Seedream 摄影感。  
**缺点**：工程量大；分割域外风险；渲染 + 生图两段延迟。

### Path C（高保真兜底，1–2 周）：纯几何终稿，不走 Seedream

1. 分割 → polygons → Blender/trimesh 网格；
2. 用 Cycles/EEVEE 做 clay render：白/浅灰、哑光、AO、柔和天光；
3. 相机按箭头方向 + 1.6m 视高；
4. 直接交付渲染图。

**优点**：零幻觉，窗数/比例/视角完全确定；可复现；不依赖生图 API。  
**缺点**：没有 Seedream 的“摄影感/氛围”；家具、材质、软装本来就不该有（白膜），所以这未必是缺点；需要 3D 资产/渲染管线。

### Path D（可选）：ControlNet Depth/Line

如果未来 Seedream 或其他生图 API 支持 ControlNet/结构条件：

- 从几何渲染导 **depth** 或 **lineart**；
- 用 ControlNet 锁结构，prompt 只写材质/光线；
- 这是 Path A 的更强版本，但当前 Seedream 链路没有 ControlNet 接口，需先验证 API。

---

## 5. 建议的 P0 离线基准（先别接生产）

在写任何生产代码前，用 10–20 张我们自己的图做基准：

| 测试维度 | 样本 | 指标 | Go/No-Go |
|---|---|---|---|
| 窗数 | 1 窗/2 窗/落地窗/带中挺 | 窗单元数准确率 | ≥90% |
| 门数 | 单门/双门/无门 | 门数准确率 | ≥90% |
| 比例 | 长条形/L 形/方厅 | bbox aspect ratio 误差 | ≤5% |
| 墙体 | 细墙/斜墙/短墙 | wall IoU（对齐后） | ≥0.80 |
| 输入 | JPG/红笔/家具/尺寸/中文标签 | 是否可分割 | 不能崩 |
| 端到端 | 3D 底图 + Seedream | 人工盲评结构 | 3/5 以上 |

**必须先验证的 4 件事**：

1. **JPG → SVG/栅格入口**：仓库只收 SVG；我们的 TG 是 JPG。需要矢量化（potrace/线稿转 SVG）或改推理入口直接吃 raster（但训练分布是 SVG 渲染图，需测试）。
2. **红笔/家具/尺寸**：分割前必须去掉，否则家具线被当墙；但比例又要靠它们。建议“双轨”：structure-only 给分割，original 给尺度/人工。
3. **窗单元合并**：不能直接 `len(polygons["window"])`；要按邻近/墙段分组，否则一扇窗多个 polygon 会报“窗太多”。
4. **绝对尺度**：仓库无米制；用层高 3m、门宽 0.9m 或尺寸标注做锚点，把像素/世界单位映射到米。

---

## 6. 最终建议

1. **不要现在替换 INT-13 主链路**。当前 Qwen+Seedream 已能出 V-004，先保住交付。
2. **先做 Path B（结构校验器）**：2–4 天，低风险，直接减少窗数/比例错误。
3. **同时跑 P0 基准**：验证 CubiCasa 模型对中国 CAD/JPG 的真实上限；如果窗数 <90%、墙 IoU <0.80，就不要急着上 Path A。
4. **Path A 作为下一阶段**：几何底图 + Seedream 参考图；这是“结构正确 + 风格好看”的最优组合。
5. **Path C 作为兜底**：如果 Seedream 仍然漂，直接用 Blender clay render 交付白膜；白膜本来就不需要摄影感。
6. **保留现有 Qwen JSON 的机位语义**：几何法需要相机 pose，Qwen 的箭头头/尾正好是 pose 来源；两者不是替代，是上下游。

---

## 7. 关键代码索引

| 主题 | 文件 | 关键点 |
|---|---|---|
| 模型 | [`model.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/model.py) | `smp.Unet(resnet34, 4 classes)` |
| 数据/letterbox | [`data.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/data.py) | 512×512, ImageNet, center pad, floor pad |
| 结构过滤 | [`svg_render.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/svg_render.py) | `DROP_TOKENS` 删家具/尺寸/文字 |
| 标签 | [`labels.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/labels.py) | 4 类、优先级、绘制顺序 |
| 训练 | [`train.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/train.py) | CE + AdamW + mIoU |
| 多边形 | [`extract_polygons.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/extract_polygons.py) | closing 3 → CCOMP → approx 1.5 → area 30 |
| 3D | [`viewer/index.html`](https://github.com/Yytsi/floorplan-to-3d/blob/main/viewer/index.html) | 墙 0.55 / 门 0.40 / 窗 0.16–0.45 |
| 服务 | [`server/main.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/server/main.py) | SVG only, 16MB, `/extract` |
| 权重 | [`Yytsi/floorplan-to-3d-walls`](https://huggingface.co/Yytsi/floorplan-to-3d-walls) | ~98MB, MIT, mIoU 0.983 |
| 数据源 | [`CubiCasa5K`](https://github.com/CubiCasa/CubiCasa5k) | 训练分布 |

---

## 8. 参考链接

- GitHub repo: https://github.com/Yytsi/floorplan-to-3d
- HuggingFace weights: https://huggingface.co/Yytsi/floorplan-to-3d-walls
- Hosted preview: https://floorplan-to-3d.pages.dev
- CubiCasa5K: https://github.com/CubiCasa/CubiCasa5k
- Model card (mirrored in repo): https://github.com/Yytsi/floorplan-to-3d/blob/main/docs/hf_model_card.md

---

## 9. 调研局限

- HuggingFace API/模型卡页面在本机网络下多次超时；模型指标（0.983 mIoU、~98MB、epoch 26）取自仓库内 `docs/hf_model_card.md`，与 HF 页面应一致，但未在本次会话直接拉取 HF 页面。
- 未运行仓库推理/训练；所有结论来自源码与模型卡，属于**静态审查**。
- 未用我们的真实 JPG 做分割测试；P0 基准必须补这一环。
