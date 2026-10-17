
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response


MAX_BYTES = 100 * 1024 * 1024
MAX_OUTPUT_BYTES = 100 * 1024 * 1024
TIMEOUT_SECONDS = 120

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://metaforge-ai-pro.vercel.app"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def verify_upload_token(token: str) -> bool:
    secret = os.environ.get("EPS_UPLOAD_SIGNING_SECRET", "").strip()
    if not secret or not token:
        return False

    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False

        payload_b64, signature_b64 = parts

        def decode_base64url(value: str) -> bytes:
            return base64.urlsafe_b64decode(
                value + "=" * (-len(value) % 4)
            )

        provided_signature = decode_base64url(signature_b64)
        expected_signature = hmac.new(
            secret.encode("utf-8"),
            payload_b64.encode("ascii"),
            hashlib.sha256,
        ).digest()

        if not hmac.compare_digest(
            provided_signature, expected_signature
        ):
            return False

        payload = json.loads(decode_base64url(payload_b64))

        if payload.get("aud") != "eps-convert":
            return False

        expires = payload.get("exp")
        if not isinstance(expires, int) or expires < int(time.time()):
            return False

        if not isinstance(payload.get("sub"), str):
            return False

        return True

    except (ValueError, TypeError, UnicodeError):
        return False


def is_authorized(authorization: str, legacy_token: str) -> bool:
    if authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
        if verify_upload_token(bearer):
            return True

    # Backward compatibility with the old static-token header.
    expected = os.environ.get("EPS_CONVERTER_TOKEN", "")
    return bool(expected and legacy_token and hmac.compare_digest(
        legacy_token, expected
    ))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/convert")
async def convert_eps(
    file: UploadFile = File(...),
    authorization: str = Header(default=""),
    x_converter_token: str = Header(default=""),
):
    if not is_authorized(authorization, x_converter_token):
        raise HTTPException(status_code=401, detail="Unauthorized or expired token")

    data = await file.read(MAX_BYTES + 1)

    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 100 MB limit")

    valid_eps = (
        data.startswith(b"%!PS-Adobe-")
        or data.startswith(bytes([0xC5, 0xD0, 0xD3, 0xC6]))
    )
    if not valid_eps:
        raise HTTPException(status_code=400, detail="Invalid EPS file")

    head = data[:131072].decode("latin-1", errors="ignore")
    match = re.search(
        r"%%BoundingBox:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)",
        head,
    )

    dpi = 100
    if match:
        x1, y1, x2, y2 = map(int, match.groups())
        longest = max(abs(x2 - x1), abs(y2 - y1), 1)
        dpi = max(20, min(150, int(3000 * 72 / longest)))

    temp_root = Path("/tmp/eps-jobs")
    temp_root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="eps-", dir=str(temp_root)
    ) as temp:
        source = Path(temp) / "input.eps"
        output = Path(temp) / "output.jpg"
        source.write_bytes(data)

        command = [
            "/usr/bin/gs",
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-dQUIET",
            "-dEPSCrop",
            "-sDEVICE=jpeg",
            "-dJPEGQ=88",
            "-dGraphicsAlphaBits=4",
            "-dTextAlphaBits=4",
            f"-r{dpi}",
            f"-sOutputFile={output}",
            str(source),
        ]

        try:
            subprocess.run(
                command,
                check=True,
                timeout=TIMEOUT_SECONDS,
                capture_output=True,
                env={
                    "PATH": "/usr/bin:/bin",
                    "HOME": "/tmp",
                    "TMPDIR": "/tmp",
                },
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="EPS conversion timed out")
        except subprocess.CalledProcessError:
            raise HTTPException(status_code=422, detail="EPS could not be rendered")

        if not output.is_file():
            raise HTTPException(status_code=422, detail="No image was produced")

        output_size = output.stat().st_size
        if output_size == 0 or output_size > MAX_OUTPUT_BYTES:
            raise HTTPException(status_code=422, detail="Invalid output size")

        jpeg = output.read_bytes()

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
