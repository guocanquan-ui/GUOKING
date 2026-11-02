# RESEARCH-13a — 提示词与约束清单

> 配套报告：[`RESEARCH-13a-floorplan-to-3d.md`](./RESEARCH-13a-floorplan-to-3d.md)  
> 重要说明：`Yytsi/floorplan-to-3d` **不是扩散模型项目**，仓库内没有自然语言 prompt / negative prompt / Canny / MLSD / LoRA。  
> 下面 A 是仓库真实参数；B/C 是给 INT-13 的**推导建议（derived）**，不是仓库原文。

---

## A. 仓库真实存在的几何约束（可直接抄）

| 类别 | 参数 | 值 | 来源 |
|---|---|---|---|
| 输入 | image_size | 512×512 | `configs/default.yaml` |
| 输入 | letterbox | true | 同上 |
| 输入 | normalize | true（ImageNet mean/std） | 同上 |
| 类别 | classes | floor / wall / door / window | `labels.py` |
| 类别 | 优先级 | Window > Door > Wall | `labels.py` |
| 类别 | 绘制顺序 | wall → door → window | `labels.py` |
| 多边形 | closing kernel | 3×3 | `extract_polygons.py` |
| 多边形 | contour mode | `RETR_CCOMP`（outer + 一级 holes） | 同上 |
| 多边形 | Douglas-Peucker | epsilon = 1.5 px | 同上 |
| 多边形 | min area | 30 px² | 同上 |
| 3D | wall height | 0.55（世界单位） | `viewer/index.html` |
| 3D | door height | 0.40 | 同上 |
| 3D | window sill / top | 0.16 / 0.45 | 同上 |
| 3D | plan normalization | 最长边 = 8.0 | 同上 |
| 3D | camera fov | 34° | 同上 |
| 3D | edge angle | 14° | 同上 |
| 训练 | encoder | ResNet-34 + ImageNet | `model.py` / config |
| 训练 | loss / opt | CE / AdamW lr 1e-3 wd 1e-4 | `train.py` |
| 训练 | batch / epochs | 8 / 30 | config |
| 服务 | upload | SVG only, ≤16MB | `server/main.py` |
| 模型卡 | val mIoU | 0.983 @ epoch 26 | `docs/hf_model_card.md` |

**不存在的项**：positive prompt、negative prompt、Canny threshold、MLSD threshold、LoRA trigger、ControlNet 参数。

---

## B. 推导 Prompt（derived，给 INT-13）

### B1. 几何底图 + Seedream 参考图（推荐）

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

### B2. 纯几何终稿（Blender/Cycles clay）

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

### B3. Qwen 结构 JSON（保留现有链路）

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

> `window_count_hint` 建议由几何分割给出，而不是让 Qwen 猜。

### B4. 相机 / 开口约束（当前 INT-13 已在用）

```text
Camera at the {tail_edge} of the plan (arrow tail), at 1.6 m eye level,
looking toward the {head_edge} (arrow head), facing the label at the arrow tip.
Any open edge on the {tail_edge} is behind the camera and must not be rendered
as a solid wall blocking the view.
```

---

## C. Canny / MLSD / LoRA 建议（derived，仓库无此层）

> 仅作为未来 ControlNet 路线的起测值；必须用我们自己的图做 A/B，不能当生产默认。

| 参数 | 起测值 | 备注 |
|---|---|---|
| Canny low | 100 | OpenCV 常用起点 |
| Canny high | 200 | 与 low 约 1:2 |
| MLSD value threshold | 0.1 | 直线结构起测 |
| MLSD distance threshold | 0.1 | 起测 |
| ControlNet weight | 0.6–0.9 | 越高越锁结构 |
| ControlNet guidance | 5–7 | 与 weight 联动 |
| Steps / sampler | 25–30 / DPM++ 2M Karras | 常用起点 |
| Img2img strength | 0.45–0.65 | 太低不改风格，太高丢结构 |
| LoRA trigger（建议） | `white clay massing`, `architectural maquette` | 不是仓库词 |
| LoRA weight | 0.6–0.8 | 起测 |

---

## D. 窗数后处理规则（必须做，否则“窗数”仍会错）

仓库的 `viewer.summarize()` 统计的是 `data.polygons.window.length`，即**多边形数**，不是窗单元数。建议：

1. 对 `window` 多边形做邻近/重叠合并（IoU > 0.2 或间距 < 3px）；
2. 过滤面积 < 30px² 的 speckle；
3. 按墙段分组：同一面墙上的相邻窗多边形合并为一个“窗带”；
4. 落地窗/带中挺窗：按外接框是否连续合并；
5. 输出 `window_units` 与 `window_polygons` 两个数，分别记录，避免 QC 误判；
6. 用门/窗的 **hole** 关系校验：窗应在 wall polygon 的 hole 上，而不是浮空。

---

## E. 来源

- https://github.com/Yytsi/floorplan-to-3d
- https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/model.py
- https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/train.py
- https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/extract_polygons.py
- https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/svg_render.py
- https://github.com/Yytsi/floorplan-to-3d/blob/main/viewer/index.html
- https://github.com/Yytsi/floorplan-to-3d/blob/main/server/main.py
- https://huggingface.co/Yytsi/floorplan-to-3d-walls
- https://github.com/CubiCasa/CubiCasa5k
