# -*- coding: utf-8 -*-
"""
债券发行全生命周期智能辅助时间线（精简版）
每阶段保留 2 个核心功能，字体更大、卡片更宽松，适合插入 Word 查看。
"""
from PIL import Image, ImageDraw, ImageFont
import os

# ============================================================================
# 输出配置
# ============================================================================
OUTPUT_PATH = "D:/！！！金科新区比赛/债券发行全生命周期智能辅助时间线.png"
WIDTH, HEIGHT = 2560, 1600

# 配色（专业金融风）
BG = "#F7F8FA"           # 浅灰背景
NAVY = "#0A2540"         # 主色
GOLD = "#C89B3C"         # 强调色
CARD_BG = "#FFFFFF"      # 卡片背景
CARD_BORDER = "#D8DDE3"  # 卡片边框
TEXT_MAIN = "#0A2540"    # 主文字
TEXT_SUB = "#4A5568"     # 次要文字
NUMBER_BG = "#EAF0F5"    # 编号背景
STAGE_BADGE = "#C89B3C"  # 阶段徽章

# 字体
FONT_PATH = "C:/Windows/Fonts/simhei.ttf"
FONT_EN = "C:/Windows/Fonts/arial.ttf"

def load_font(size):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except:
        return ImageFont.load_default()

def load_en_font(size):
    try:
        return ImageFont.truetype(FONT_EN, size)
    except:
        return load_font(size)

# 字号（整体偏大，确保 Word 缩印后仍清晰）
TITLE_FONT = load_font(72)
SUBTITLE_FONT = load_font(30)
STAGE_TITLE_FONT = load_font(40)
STAGE_EN_FONT = load_en_font(26)
FUNC_TITLE_FONT = load_font(38)
FUNC_DESC_FONT = load_font(30)
NUMBER_FONT = load_font(32)
FOOTER_FONT = load_font(22)

# ============================================================================
# 数据：每阶段 2 个功能
# ============================================================================
stages = [
    {
        "name": "发行前",
        "en": "Pre-Issue",
        "items": [
            {
                "title": "募集材料自动审核",
                "desc": "OCR + NLP 自动提取并核验募集说明书关键信息，识别材料缺漏与合规风险点，提升申报效率。",
                "tags": ["OCR", "NLP", "合规校验"],
            },
            {
                "title": "招标书信息核对",
                "desc": "自动比对招标书与披露文件一致性，锁定关键条款差异，降低发行前信息差错。",
                "tags": ["文本比对", "差异定位", "披露一致性"],
            },
        ],
    },
    {
        "name": "发行中",
        "en": "Issue Execution",
        "items": [
            {
                "title": "收益偏差实时预警",
                "desc": "基于估值数据实时监测收益率偏离异常，及时提示市场波动与定价偏离风险，辅助动态决策。",
                "tags": ["实时估值", "偏离监测", "动态预警"],
            },
            {
                "title": "投标数据智能分析",
                "desc": "多维度分析投标分布、投资者结构与价格集中度，为发行定价提供量化参考。",
                "tags": ["多维分布", "投资者画像", "定价参考"],
            },
        ],
    },
    {
        "name": "发行后",
        "en": "Post-Issue",
        "items": [
            {
                "title": "承销商投标策略回溯分析",
                "desc": "基于历史投标与中标数据，量化报价策略与配售偏好，为后续承销决策提供优化建议。",
                "tags": ["历史回溯", "策略画像", "承销优化"],
            },
            {
                "title": "统计报表自动生成",
                "desc": "按发行人、监管及内部管理需求，自动生成多维度统计报表与可视化分析。",
                "tags": ["多维报表", "可视化", "监管报送"],
            },
        ],
    },
]

# ============================================================================
# 绘图
# ============================================================================
img = Image.new("RGB", (WIDTH, HEIGHT), BG)
draw = ImageDraw.Draw(img)

# 顶部深色标题栏
draw.rectangle([0, 0, WIDTH, 180], fill=NAVY)

# 主标题
title = "债券发行全生命周期智能辅助时间线"
draw.text((WIDTH // 2, 55), title, font=TITLE_FONT, fill="white", anchor="mt")

# 副标题
subtitle = "智债中枢 BondMind · 金融基础设施级债券发行智能辅助平台"
draw.text((WIDTH // 2, 130), subtitle, font=SUBTITLE_FONT, fill="#B8C4CE", anchor="mt")

# 布局参数
MARGIN_X = 130
MARGIN_TOP = 230
MARGIN_BOTTOM = 120
COL_GAP = 80
STAGE_HEADER_H = 100
CARD_GAP_Y = 50

usable_width = WIDTH - MARGIN_X * 2 - COL_GAP * 2
col_width = usable_width // 3
usable_height = HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - STAGE_HEADER_H - CARD_GAP_Y
card_height = min(usable_height // 2, 520)

for col, stage in enumerate(stages):
    x = MARGIN_X + col * (col_width + COL_GAP)
    
    # 阶段标题条
    stage_y = MARGIN_TOP
    draw.rounded_rectangle(
        [x, stage_y, x + col_width, stage_y + STAGE_HEADER_H],
        radius=12,
        fill=NAVY,
    )
    # 阶段名
    draw.text((x + col_width // 2, stage_y + 28), stage["name"], font=STAGE_TITLE_FONT, fill="white", anchor="mt")
    # 英文名
    draw.text((x + col_width // 2, stage_y + 72), stage["en"], font=STAGE_EN_FONT, fill=GOLD, anchor="mt")
    
    # 阶段间箭头（第1、2列右侧）
    if col < 2:
        arrow_x = x + col_width + COL_GAP // 2
        arrow_y = stage_y + STAGE_HEADER_H // 2
        # 简单箭头
        draw.polygon(
            [(arrow_x - 30, arrow_y - 22), (arrow_x + 30, arrow_y), (arrow_x - 30, arrow_y + 22)],
            fill="#BDC7D1",
        )
    
    # 功能卡片
    for row, item in enumerate(stage["items"]):
        card_y = stage_y + STAGE_HEADER_H + CARD_GAP_Y + row * (card_height + CARD_GAP_Y)
        
        # 卡片背景
        draw.rounded_rectangle(
            [x, card_y, x + col_width, card_y + card_height],
            radius=16,
            fill=CARD_BG,
            outline=CARD_BORDER,
            width=2,
        )
        
        # 左侧金色竖条
        draw.rounded_rectangle(
            [x, card_y, x + 12, card_y + card_height],
            radius=16,
            fill=GOLD,
        )
        
        # 编号圆圈
        circle_x = x + 60
        circle_y = card_y + 60
        r = 34
        draw.ellipse([circle_x - r, circle_y - r, circle_x + r, circle_y + r], fill=NUMBER_BG, outline=GOLD, width=3)
        draw.text((circle_x, circle_y), str(row + 1), font=NUMBER_FONT, fill=NAVY, anchor="mm")
        
        # 功能标题
        title_x = x + 120
        title_y = card_y + 55
        draw.text((title_x, title_y), item["title"], font=FUNC_TITLE_FONT, fill=TEXT_MAIN, anchor="lm")
        
        # 分隔线
        line_y = card_y + 110
        draw.line([(title_x, line_y), (x + col_width - 40, line_y)], fill="#E2E8F0", width=2)
        
        # 描述文字（自动换行）
        desc_x = title_x
        desc_y = line_y + 35
        max_desc_width = col_width - 160
        desc = item["desc"]
        words = list(desc)
        lines = []
        current_line = ""
        for ch in words:
            test_line = current_line + ch
            bbox = draw.textbbox((0, 0), test_line, font=FUNC_DESC_FONT)
            if bbox[2] - bbox[0] <= max_desc_width:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = ch
        if current_line:
            lines.append(current_line)
        
        line_h = 50
        shown_lines = lines[:5]
        for i, line in enumerate(shown_lines):
            draw.text((desc_x, desc_y + i * line_h), line, font=FUNC_DESC_FONT, fill=TEXT_SUB, anchor="lm")
        
        # 关键词标签（位于卡片底部）
        tags = item.get("tags", [])
        if tags:
            TAG_FONT = load_font(20)
            tag_margin = 10
            tag_h = 36
            tag_y = card_y + card_height - 62
            cur_x = desc_x
            for tag in tags:
                text = f"  {tag}  "
                bbox = draw.textbbox((0, 0), text, font=TAG_FONT)
                tw = bbox[2] - bbox[0]
                # 标签背景
                draw.rounded_rectangle(
                    [cur_x, tag_y, cur_x + tw, tag_y + tag_h],
                    radius=18,
                    fill="#F0F4F8",
                    outline="#D0D8E0",
                    width=1,
                )
                draw.text((cur_x + tw // 2, tag_y + tag_h // 2), text, font=TAG_FONT, fill=NAVY, anchor="mm")
                cur_x += tw + tag_margin

# 底部 footer
footer_y = HEIGHT - 70
draw.text((WIDTH // 2, footer_y), "智债中枢 BondMind · 覆盖债券发行前 / 中 / 后全生命周期智能辅助", font=FOOTER_FONT, fill="#718096", anchor="mm")

# 保存
img.save(OUTPUT_PATH, "PNG", dpi=(300, 300))
print(f"已生成：{OUTPUT_PATH}  ({WIDTH}x{HEIGHT})")
