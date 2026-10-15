"""Focused PDF endpoint check; run with python3 statement_server_test.py."""
import json
import io
from email.message import Message
from types import SimpleNamespace

import start


def pdf(contents):
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(contents) + contents + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    data = b"%PDF-1.4\n"
    offsets = [0]
    for number, item in enumerate(objects, 1):
        offsets.append(len(data))
        data += b"%d 0 obj\n" % number + item + b"\nendobj\n"
    xref = len(data)
    data += b"xref\n0 6\n0000000000 65535 f \n"
    data += b"".join(b"%010d 00000 n \n" % offset for offset in offsets[1:])
    return data + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref


def request(body, origin=None):
    headers = Message()
    headers["Content-Type"] = "application/pdf"
    headers["Host"] = "localhost:4173"
    headers["Content-Length"] = str(len(body))
    if origin:
        headers["Origin"] = origin
    handler = object.__new__(start.AppHandler)
    handler.path = "/pdf-text"
    handler.headers = headers
    handler.rfile = io.BytesIO(body)
    handler.connection = SimpleNamespace(settimeout=lambda _: None)
    outcome = {}
    handler.respond = lambda status, body=b"", **_: outcome.update(status=status, body=body)
    handler.send_error = lambda status, *_: outcome.update(status=status, body=b"")
    handler.do_POST()
    return outcome["status"], json.loads(outcome["body"] or b"{}")


source = pdf(b"BT /F1 12 Tf 72 720 Td (24/09/2026 MARKET -12,34) Tj ET")
status, result = request(source, "http://localhost:4173")
assert status == 200 and "MARKET -12,34" in result["text"], (status, result)
assert request(source, "https://elsewhere.example")[0] == 403
assert request(b"not a PDF")[0] == 400
status, result = request(pdf(b""))
assert status == 422 and "scanned" in result["error"], (status, result)

# pdftotext that floods stderr with font warnings while still working must not be killed.
import os
import stat
import tempfile
with tempfile.TemporaryDirectory() as stub_dir:
    stub = os.path.join(stub_dir, "pdftotext")
    with open(stub, "w") as handle:
        handle.write("#!/bin/sh\nawk 'BEGIN{for(i=0;i<2000;i++)print \"Syntax Warning: bad font table\" > \"/dev/stderr\"}'\nsleep 0.3\necho '24/09/2026 MARKET -12,34'\n")
    os.chmod(stub, stat.S_IRWXU)
    original_path = os.environ["PATH"]
    os.environ["PATH"] = stub_dir + os.pathsep + original_path
    try:
        status, result = request(source, "http://localhost:4173")
    finally:
        os.environ["PATH"] = original_path
    assert status == 200 and "MARKET -12,34" in result["text"], (status, result)
