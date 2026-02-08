"""Parse Zoho Books payment PDF and extract payment details."""
import re
import pdfplumber


def extract_payment_data(pdf_path: str) -> dict:
    """Extract payment fields from a Zoho Books payment PDF.

    Returns a dict with keys:
        payment_number, payment_date, reference_number,
        paid_to, paid_through, amount, currency, amount_in_words,
        bills (list of dicts with bill_number, bill_date, bill_amount, payment_amount)
    """
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += page.extract_text(layout=True) + "\n"

    data = {
        "payment_number": "",
        "payment_date": "",
        "reference_number": "",
        "paid_to": "",
        "paid_through": "",
        "amount": "",
        "currency": "AED",
        "amount_in_words": "",
        "bills": [],
    }

    lines = text.split("\n")

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Payment#
        if re.search(r"Payment\s*#", stripped):
            m = re.search(r"Payment\s*#\s+(\S+)", stripped)
            if m:
                data["payment_number"] = m.group(1)

        # Payment Date
        if re.search(r"Payment\s+Date", stripped):
            m = re.search(r"Payment\s+Date\s+([\d]+\s+\w+\s+\d{4})", stripped)
            if m:
                data["payment_date"] = m.group(1)

        # Reference Number
        if re.search(r"Reference\s+Number", stripped):
            m = re.search(r"Reference\s+Number\s+(\S+)", stripped)
            if m:
                data["reference_number"] = m.group(1)

        # Paid To
        if re.search(r"Paid\s+To", stripped):
            m = re.search(r"Paid\s+To\s+(.+)", stripped)
            if m:
                paid_to = m.group(1).strip()
                # Check if continues on next line
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and not re.match(
                        r"(Paid\s+Through|Amount|Payment)", next_line
                    ):
                        paid_to += " " + next_line
                data["paid_to"] = paid_to.strip()

        # Paid Through
        if re.search(r"Paid\s+Through", stripped):
            m = re.search(r"Paid\s+Through\s+(.+)", stripped)
            if m:
                data["paid_through"] = m.group(1).strip()

        # Amount Paid
        if re.search(r"Amount\s+Paid", stripped) and not re.search(
            r"In\s+Words", stripped
        ):
            m = re.search(r"AED\s*([\d,]+\.?\d*)", stripped)
            if m:
                data["amount"] = m.group(1)

        # Amount Paid In Words
        if re.search(r"Amount\s+Paid\s+In\s+Words", stripped):
            m = re.search(r"Amount\s+Paid\s+In\s+Words\s+(.+)", stripped)
            if m:
                words = m.group(1).strip()
                # Check next line for continuation
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and not re.match(
                        r"(Payment\s+for|Bill\s+Number|$)", next_line
                    ):
                        words += " " + next_line
                data["amount_in_words"] = words.strip()

        # Bills table rows: INV XXXXXX  date  amount  amount
        bill_match = re.match(
            r"(INV\s*\d+)\s+([\d]+\s+\w+\s+\d{4})\s+AED([\d,]+\.?\d*)\s+AED([\d,]+\.?\d*)",
            stripped,
        )
        if bill_match:
            data["bills"].append(
                {
                    "bill_number": bill_match.group(1).strip(),
                    "bill_date": bill_match.group(2).strip(),
                    "bill_amount": bill_match.group(3).strip(),
                    "payment_amount": bill_match.group(4).strip(),
                }
            )

    return data
