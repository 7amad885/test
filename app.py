"""Flask application for Payment Voucher generation from Zoho Books payments."""
import os
import uuid
import json
from flask import (
    Flask, render_template, request, redirect, url_for, send_file, jsonify,
    flash, session
)
from pdf_parser import extract_payment_data
from pdf_generator import generate_voucher_pdf

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'payment-voucher-secret-key')

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'output')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {'pdf'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    """Upload page."""
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    """Handle PDF upload and extract payment data."""
    if 'file' not in request.files:
        flash('No file selected', 'error')
        return redirect(url_for('index'))

    file = request.files['file']
    if file.filename == '':
        flash('No file selected', 'error')
        return redirect(url_for('index'))

    if not allowed_file(file.filename):
        flash('Only PDF files are allowed', 'error')
        return redirect(url_for('index'))

    # Save uploaded file
    file_id = str(uuid.uuid4())
    filename = f"{file_id}.pdf"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    # Extract data
    try:
        data = extract_payment_data(filepath)
    except Exception as e:
        flash(f'Error parsing PDF: {e}', 'error')
        return redirect(url_for('index'))

    # Store in session
    session['payment_data'] = data
    session['upload_id'] = file_id

    return render_template('review.html', data=data)


@app.route('/generate', methods=['POST'])
def generate():
    """Generate the payment voucher PDF from reviewed data."""
    data = {
        'payment_number': request.form.get('payment_number', ''),
        'payment_date': request.form.get('payment_date', ''),
        'reference_number': request.form.get('reference_number', ''),
        'paid_to': request.form.get('paid_to', ''),
        'paid_through': request.form.get('paid_through', ''),
        'amount': request.form.get('amount', ''),
        'currency': request.form.get('currency', 'AED'),
        'amount_in_words': request.form.get('amount_in_words', ''),
        'paid_for': request.form.get('paid_for', ''),
        'account_number': request.form.get('account_number', '12009483001'),
        'payee_account': request.form.get('payee_account', '-'),
        # Signature fields
        'sig_name_0': request.form.get('sig_name_0', ''),
        'sig_name_1': request.form.get('sig_name_1', ''),
        'sig_name_2': request.form.get('sig_name_2', ''),
        'sig_name_3': request.form.get('sig_name_3', ''),
        'sig_date_0': request.form.get('sig_date_0', ''),
        'sig_date_1': request.form.get('sig_date_1', ''),
        'sig_date_2': request.form.get('sig_date_2', ''),
        'sig_date_3': request.form.get('sig_date_3', ''),
    }

    file_id = str(uuid.uuid4())
    output_path = os.path.join(OUTPUT_FOLDER, f"voucher_{file_id}.pdf")

    try:
        generate_voucher_pdf(data, output_path)
    except Exception as e:
        flash(f'Error generating PDF: {e}', 'error')
        return redirect(url_for('index'))

    return send_file(
        output_path,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f"Payment_Voucher_PAY{data['payment_number']}.pdf"
    )


@app.route('/manual')
def manual():
    """Manual entry form (no upload needed)."""
    data = {
        'payment_number': '',
        'payment_date': '',
        'reference_number': '',
        'paid_to': '',
        'paid_through': '',
        'amount': '',
        'currency': 'AED',
        'amount_in_words': '',
        'bills': [],
    }
    return render_template('review.html', data=data)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
