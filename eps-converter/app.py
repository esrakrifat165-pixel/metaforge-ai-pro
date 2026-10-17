
import hmac
import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import Response

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BYTES = 100 * 1024 * 1024
MAX_OUTPUT_BYTES = 100 * 1024 * 1024
TIMEOUT_SECONDS = 120

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/convert")
async def convert_eps(
    file: UploadFile = File(...),
    x_converter_token: str = Header(default=""),
):
    expected = os.environ.get("EPS_CONVERTER_TOKEN", "")

    if not expected or not hmac.compare_digest(x_converter_token, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")

    data = await file.read(MAX_BYTES + 1)

    if not data or len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File is empty or too large")

    valid_eps = data.startswith(b"%!PS-Adobe-") or data.startswith(
        bytes([0xC5, 0xD0, 0xD3, 0xC6])
    )

    if not valid_eps:
        raise HTTPException(status_code=400, detail="Invalid EPS file")

    head = data[:131072].decode("latin-1", errors="ignore")
    import re

    match = re.search(
        r"%%BoundingBox:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)",
        head,
    )

    dpi = 100
    if match:
        x1, y1, x2, y2 = map(int, match.groups())
        longest = max(abs(x2 - x1), abs(y2 - y1), 1)
        dpi = max(20, min(150, int(3000 * 72 / longest)))

    with tempfile.TemporaryDirectory(prefix="eps-", dir="/tmp/eps-jobs") as temp:
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

        if not output.exists():
            raise HTTPException(status_code=422, detail="No image was produced")

        if output.stat().st_size == 0 or output.stat().st_size > MAX_OUTPUT_BYTES:
            raise HTTPException(status_code=422, detail="Invalid output size")

        jpeg = output.read_bytes()

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )
