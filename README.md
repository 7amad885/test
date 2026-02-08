# Payment Voucher Generator - Sharjah Media City

A single-page web application that converts Zoho Books payment PDFs into professionally formatted Sharjah Media City (SHAMS) payment vouchers.

## Quick Start

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Drag & drop a Zoho Books payment PDF onto the upload area (or click to browse)
3. Review the extracted payment data
4. Click **Generate Voucher PDF** to download the formatted voucher

That's it — no installation, no server, no setup required.

## Features

- **Drag & drop** PDF upload or file picker
- **Automatic extraction** of payment data from Zoho Books PDFs
- **Real-time preview** of extracted fields before generation
- **One-click PDF generation** with automatic download
- **Fully client-side** — no data leaves your browser
- **Works offline** after initial page load

## Extracted Fields

The app extracts the following from Zoho Books payment PDFs:

| Field | Example |
|-------|---------|
| Payment Number | 1141 |
| Payment Date | 06 Nov 2025 |
| Reference Number | 4621 |
| Paid To | CUZMA HUB FOR MARKETING MANAGEMENT CO. |
| Amount (AED) | 46,200.00 |
| Amount in Words | UAE Dirham Forty-Six Thousand Two Hundred |
| Paid Through | Sharjah Media City FZA - SIB |
| Description | Professional Services (default) |

## Output

Generated vouchers include:

- SHAMS company header with logo and TRN
- Payment metadata (date, voucher type, reference)
- Payment information (amount, bank details, cheque reference)
- Payee details
- Approval section with signature spaces for:
  - Prepared By: Saeed Al Fayed
  - Reviewed By: Mariam Alhaddad
  - Approved By: Ahmed Alnoman
  - Approved By: Director General

**File naming:** `Payment_Voucher_[PaymentNumber]_[DD-MMM-YY].pdf`

## Technical Details

- **Self-contained** single HTML file (~30KB)
- **No build process** — uses CDN dependencies:
  - React 18 (UI)
  - PDF.js 3.x (PDF text extraction)
  - jsPDF 2.x (PDF generation)
  - Babel standalone (JSX transformation)
- **No server required** — runs entirely in the browser

## Browser Support

- Google Chrome (recommended)
- Mozilla Firefox
- Microsoft Edge
- Safari

## Troubleshooting

- **"Could not extract payment data"** — Ensure the PDF is a Zoho Books payment export, not a scanned image
- **Missing fields** — Some optional fields (like Description) default to "Professional Services"
- **File not accepted** — Only `.pdf` files are supported
