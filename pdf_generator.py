"""Generate a Payment Voucher PDF matching the Sharjah Media City format."""
import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Spacer, Paragraph, Image, Frame,
    PageTemplate, BaseDocTemplate
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas as pdfcanvas


# Colors
RED = HexColor('#C8102E')
DARK_GRAY = HexColor('#333333')
LIGHT_GRAY = HexColor('#F5F5F5')
BORDER_GRAY = HexColor('#CCCCCC')
WHITE = white

LOGO_PATH = os.path.join(os.path.dirname(__file__), 'static', 'images', 'logo.png')


def _wrap_text(canvas_obj, text, font_name, font_size, max_width):
    """Split text into lines that fit within max_width."""
    words = text.split()
    lines = []
    current_line = ''
    for word in words:
        test = f"{current_line} {word}".strip() if current_line else word
        w = canvas_obj.stringWidth(test, font_name, font_size)
        if w <= max_width:
            current_line = test
        else:
            if current_line:
                lines.append(current_line)
            current_line = word
    if current_line:
        lines.append(current_line)
    return lines if lines else ['']


def generate_voucher_pdf(data: dict, output_path: str) -> str:
    """Generate the payment voucher PDF.

    Args:
        data: dict with payment details
        output_path: where to save the PDF

    Returns:
        The output_path
    """
    width, height = A4
    c = pdfcanvas.Canvas(output_path, pagesize=A4)

    # Margins
    left = 40
    right = width - 40
    content_width = right - left
    top = height - 40

    # ── Border around the entire page ──
    c.setStrokeColor(BORDER_GRAY)
    c.setLineWidth(1)
    c.rect(left - 10, 30, content_width + 20, top - 20)

    y = top - 20

    # ── Header: Logo left, Arabic/English name right ──
    if os.path.exists(LOGO_PATH):
        c.drawImage(LOGO_PATH, left, y - 50, width=130, height=50,
                     preserveAspectRatio=True, mask='auto')

    # Right-aligned header text
    c.setFont('Helvetica-Bold', 14)
    c.setFillColor(DARK_GRAY)
    c.drawRightString(right, y - 20, 'Sharjah Media City')

    y -= 70

    # ── Red separator line ──
    c.setStrokeColor(RED)
    c.setLineWidth(2)
    c.line(left, y, right, y)
    y -= 5

    # ── Title: Payment Voucher ──
    c.setFont('Helvetica-Bold', 16)
    c.setFillColor(black)
    c.drawString(left, y - 15, 'Payment Voucher')
    y -= 40

    # ── Row: Date / Voucher Type / Ref. No. ──
    row_height = 22
    box_h = 18

    # Date
    c.setFont('Helvetica-Bold', 9)
    c.setFillColor(black)
    c.drawString(left, y, 'Date:')
    c.setStrokeColor(BORDER_GRAY)
    c.setLineWidth(0.5)
    c.rect(left + 60, y - 3, 120, box_h)
    c.setFont('Helvetica', 9)
    c.drawString(left + 65, y + 2, data.get('payment_date', ''))

    # Ref. No.
    c.setFont('Helvetica-Bold', 9)
    c.drawString(left + 280, y, 'Ref. No.:')
    c.rect(left + 330, y - 3, 120, box_h)
    c.setFont('Helvetica', 9)
    ref_text = f"PAY {data.get('payment_number', '')}"
    c.drawString(left + 335, y + 2, ref_text)
    y -= 30

    # Voucher type
    c.setFont('Helvetica-Bold', 9)
    c.drawString(left, y, 'Voucher type:')
    c.rect(left + 80, y - 3, 100, box_h)
    c.setFont('Helvetica', 9)
    c.drawString(left + 85, y + 2, 'Automatic')
    y -= 30

    # Company name
    c.setFont('Helvetica-Bold', 9)
    c.drawString(left, y, 'Company name:')
    c.rect(left + 90, y - 3, 250, box_h)
    c.setFont('Helvetica', 9)
    c.drawString(left + 95, y + 2, 'Sharjah Media City (FZA)')
    y -= 35

    # ── Payment Information Table ──
    c.setStrokeColor(black)
    c.setLineWidth(0.8)

    table_left = left
    table_right = right
    table_w = table_right - table_left
    col_mid = table_left + table_w * 0.55

    # Header
    c.setFillColor(LIGHT_GRAY)
    c.rect(table_left, y - 2, table_w, 18, fill=1)
    c.setFillColor(black)
    c.setFont('Helvetica-Bold', 10)
    c.drawCentredString(table_left + table_w / 2, y + 2, 'Payment Information')
    c.setStrokeColor(black)
    c.rect(table_left, y - 2, table_w, 18)
    y -= 22

    def draw_info_row(label1, val1, label2, val2, y_pos):
        c.setStrokeColor(BORDER_GRAY)
        c.setLineWidth(0.5)
        # Left cell
        c.setFont('Helvetica-Bold', 9)
        c.setFillColor(black)
        c.drawString(table_left + 5, y_pos + 3, label1)
        c.setFont('Helvetica', 9)
        c.drawString(table_left + 110, y_pos + 3, str(val1))
        # Right cell
        if label2:
            c.setFont('Helvetica-Bold', 9)
            c.drawString(col_mid + 5, y_pos + 3, label2)
            c.setFont('Helvetica', 9)
            c.drawString(col_mid + 80, y_pos + 3, str(val2))
        # Lines
        c.line(table_left, y_pos, table_right, y_pos)
        c.line(table_left, y_pos, table_left, y_pos + 16)
        c.line(table_right, y_pos, table_right, y_pos + 16)
        if label2:
            c.line(col_mid, y_pos, col_mid, y_pos + 16)
        return y_pos - 18

    amount_str = data.get('amount', '')
    currency = data.get('currency', 'AED')
    words = data.get('amount_in_words', '')
    ref_no = data.get('reference_number', '')
    paid_through = data.get('paid_through', '')

    # Derive bank name from paid_through
    bank_name = paid_through
    if 'SIB' in paid_through.upper():
        bank_name = 'Sharjah Islamic Bank (SIB)'

    y = draw_info_row('Amount:', amount_str, 'Currency:', currency, y)
    y = draw_info_row('In words:', words, '', '', y)
    y = draw_info_row('Mode of payment:', 'Cheque', 'Ref. No.:', ref_no, y)
    y = draw_info_row('Bank name:', bank_name, 'Acct. No.:', data.get('account_number', '12009483001'), y)

    # Bottom border
    c.line(table_left, y + 18, table_left, y)
    c.line(table_right, y + 18, table_right, y)
    c.line(table_left, y, table_right, y)

    y -= 25

    # ── Payee Information ──
    c.setStrokeColor(black)
    c.setLineWidth(0.8)

    payee_top = y + 16
    c.setFont('Helvetica-Bold', 9)
    c.drawString(table_left + 5, y + 2, 'Name:')
    c.setFont('Helvetica', 9)
    paid_to = data.get('paid_to', '')
    c.drawString(table_left + 60, y + 2, paid_to)

    c.setFont('Helvetica-Bold', 9)
    c.drawString(col_mid + 5, y + 2, 'Acct. No.:')
    c.setFont('Helvetica', 9)
    c.drawString(col_mid + 60, y + 2, data.get('payee_account', '-'))
    y -= 18

    c.setFont('Helvetica-Bold', 9)
    c.drawString(table_left + 5, y + 2, 'Paid for:')
    c.setFont('Helvetica', 8)
    paid_for = data.get('paid_for', '')
    # Wrap paid_for text across multiple lines if needed
    paid_for_x = table_left + 55
    max_paid_for_w = table_right - paid_for_x - 5
    pf_lines = _wrap_text(c, paid_for, 'Helvetica', 8, max_paid_for_w)
    for li, pf_line in enumerate(pf_lines):
        c.drawString(paid_for_x, y + 2 - (li * 12), pf_line)
    extra_pf_lines = max(0, len(pf_lines) - 1)
    y -= extra_pf_lines * 12

    payee_bottom = y
    # Border around payee section
    c.rect(table_left, payee_bottom, table_w, payee_top - payee_bottom)
    c.line(table_left, payee_bottom + 18 + extra_pf_lines * 12, table_right,
           payee_bottom + 18 + extra_pf_lines * 12)
    c.line(col_mid, payee_top, col_mid, payee_top - 18)

    y -= 35

    # ── Signature Section ──
    sig_cols = 4
    sig_col_w = table_w / sig_cols
    sig_labels = ['Prepared By', 'Reviewed By', 'Approved By', 'Approved By']
    sig_sublabels = ['', '', '', 'Director General']

    sig_top = y + 16

    # "Name:" header row
    c.setFillColor(LIGHT_GRAY)
    c.rect(table_left, y - 2, table_w, 18, fill=1)
    c.setFillColor(black)
    c.setFont('Helvetica-Bold', 9)
    # Center "Name:" label
    c.drawCentredString(table_left + sig_col_w / 2, y + 2, '')
    for i, label in enumerate(sig_labels):
        x = table_left + i * sig_col_w
        sub = sig_sublabels[i]
        full_label = label if not sub else f"{label}"
        c.drawCentredString(x + sig_col_w / 2, y + 2, full_label)
        if sub:
            c.setFont('Helvetica', 7)
            c.drawCentredString(x + sig_col_w / 2, y - 7, sub)
            c.setFont('Helvetica-Bold', 9)

    c.setStrokeColor(black)
    c.rect(table_left, y - 12, table_w, 28)
    for i in range(1, sig_cols):
        c.line(table_left + i * sig_col_w, y - 12, table_left + i * sig_col_w, y + 16)

    y -= 30

    # Name row
    c.setFont('Helvetica-Bold', 9)
    c.drawString(table_left + 5, y + 2, 'Name:')
    for i in range(sig_cols):
        x = table_left + i * sig_col_w
        name = data.get(f'sig_name_{i}', '')
        c.setFont('Helvetica', 8)
        c.drawCentredString(x + sig_col_w / 2, y + 2, name)
    c.rect(table_left, y - 2, table_w, 18)
    for i in range(1, sig_cols):
        c.line(table_left + i * sig_col_w, y - 2, table_left + i * sig_col_w, y + 16)
    y -= 20

    # Date row
    c.setFont('Helvetica-Bold', 9)
    c.drawString(table_left + 5, y + 2, 'Date:')
    for i in range(sig_cols):
        x = table_left + i * sig_col_w
        date = data.get(f'sig_date_{i}', '')
        c.setFont('Helvetica', 8)
        c.drawCentredString(x + sig_col_w / 2, y + 2, date)
    c.rect(table_left, y - 2, table_w, 18)
    for i in range(1, sig_cols):
        c.line(table_left + i * sig_col_w, y - 2, table_left + i * sig_col_w, y + 16)
    y -= 20

    # Signature row (empty, tall for actual signatures)
    sig_row_h = 50
    c.rect(table_left, y - sig_row_h + 16, table_w, sig_row_h)
    for i in range(1, sig_cols):
        c.line(table_left + i * sig_col_w, y - sig_row_h + 16,
               table_left + i * sig_col_w, y + 16)

    c.save()
    return output_path
