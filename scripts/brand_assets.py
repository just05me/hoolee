"""Regenerate the social card: python3 scripts/brand_assets.py (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
image = Image.new('RGB', (1200, 630), '#08090b')
d = ImageDraw.Draw(image)
d.rounded_rectangle((46,46,1154,584),radius=30,outline='#30343b',width=2)
# mark: arch "A" + orbit dot, same geometry as site/static/logo.svg (64-unit box), drawn 8x and downsampled
Z=8; SIZE=64
mark=Image.new('RGBA',(SIZE*Z,SIZE*Z),(0,0,0,0)); m=ImageDraw.Draw(mark)
def q(x,y): return (x*Z,y*Z)
def stroke_line(a,b,w=6):
    m.line([q(*a),q(*b)],fill='#f5f5f7',width=w*Z)
    for x,y in (a,b): m.ellipse((x*Z-w*Z/2,y*Z-w*Z/2,x*Z+w*Z/2,y*Z+w*Z/2),fill='#f5f5f7')
stroke_line((17,50),(17,34)); stroke_line((47,34),(47,50)); stroke_line((17,40),(47,40))
m.arc((17*Z-3*Z,19*Z-3*Z+0,47*Z+3*Z,49*Z+3*Z),180,360,fill='#f5f5f7',width=6*Z)
m.arc((17*Z,19*Z,47*Z,49*Z),180,360,fill=None) if False else None
m.ellipse((42*Z,14*Z,52*Z,24*Z),fill='#70b5ff')
mark=mark.resize((112,112),Image.LANCZOS)
image.paste(mark,(66,58),mark)
d.text((172,91),'ARCOAI',font=ImageFont.truetype(BOLD,53),fill='#f5f5f7')
d.text((86,236),'Less busywork.',font=ImageFont.truetype(BOLD,76),fill='#f5f5f7')
d.text((86,326),'More business.',font=ImageFont.truetype(BOLD,76),fill='#70b5ff')
d.text((90,485),'AI Orchestrator · business automation',font=ImageFont.truetype(FONT,25),fill='#a3a5af')
d.text((934,512),'arcoai.info',font=ImageFont.truetype(FONT,24),fill='#a3a5af')
image.save(ROOT/'site/static/og.png', optimize=True)
