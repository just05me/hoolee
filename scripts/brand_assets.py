"""Regenerate the social card: python3 scripts/brand_assets.py (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
image = Image.new('RGB', (1200, 630), '#08090b')
d = ImageDraw.Draw(image)
d.rounded_rectangle((46,46,1154,584),radius=30,outline='#30343b',width=2)
d.line([(90,96),(90,152)],fill='#f5f5f7',width=9)
d.line([(133,96),(133,152)],fill='#f5f5f7',width=9)
d.arc((85,110,138,145),180,360,fill='#f5f5f7',width=8)
d.ellipse((127,121,139,133),fill='#70b5ff')
d.text((155,91),'hoolee',font=ImageFont.truetype(BOLD,53),fill='#f5f5f7')
d.text((86,236),'Less busywork.',font=ImageFont.truetype(BOLD,76),fill='#f5f5f7')
d.text((86,326),'More business.',font=ImageFont.truetype(BOLD,76),fill='#70b5ff')
d.text((90,485),'Custom software & business automation',font=ImageFont.truetype(FONT,25),fill='#a3a5af')
d.text((934,512),'arcoai.info',font=ImageFont.truetype(FONT,24),fill='#a3a5af')
image.save(ROOT/'site/static/og.png', optimize=True)
