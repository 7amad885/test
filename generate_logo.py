"""Generate the Sharjah Media City logo as a PNG using ReportLab."""
from reportlab.lib.units import mm
from reportlab.graphics.shapes import Drawing, String, Circle, Rect, Group
from reportlab.graphics import renderPM
from reportlab.lib.colors import HexColor

def create_logo():
    """Create a simplified Sharjah Media City logo."""
    d = Drawing(200, 80)

    # Red circle background for the emblem
    red = HexColor('#C8102E')
    d.add(Circle(40, 40, 30, fillColor=red, strokeColor=None))

    # White text inside circle
    d.add(String(25, 45, 'شمس', fontSize=16, fillColor=HexColor('#FFFFFF'),
                 fontName='Helvetica-Bold'))
    d.add(String(22, 30, 'Shams', fontSize=11, fillColor=HexColor('#FFFFFF'),
                 fontName='Helvetica-Bold'))

    # Arabic company name
    d.add(String(80, 55, 'مدينة الشارقة للإعلام', fontSize=14,
                 fillColor=HexColor('#333333'), fontName='Helvetica'))

    # English company name
    d.add(String(80, 35, 'Sharjah Media City', fontSize=14,
                 fillColor=HexColor('#333333'), fontName='Helvetica-Bold'))

    renderPM.drawToFile(d, '/home/user/test/static/images/logo.png', fmt='PNG',
                        dpi=150)
    print("Logo generated at static/images/logo.png")

if __name__ == '__main__':
    create_logo()
