"""Extract page text from a PDF given on stdin. stdout is a bounded JSON reply."""
import io
import json
import sys


def extract():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
        from pypdf import PdfReader
    except ImportError:
        return {"error": "dependency"}
    try:
        source = io.BytesIO(sys.stdin.buffer.read(15 * 1024**2 + 1))
        pdf = PdfReader(source, strict=False)
        if pdf.is_encrypted:
            return {"error": "encrypted"}
        if not 0 < len(pdf.pages) <= 250:
            return {"error": "pages"}
        result = []
        total = 0
        for page in pdf.pages:
            text = (page.extract_text() or "").strip()
            total += len(text)
            if total > 450_000:
                return {"error": "text_limit"}
            result.append(text)
        if sum(char.isalnum() for text in result for char in text) < 8:
            return {"error": "empty"}
        return {"pages": result}
    except Exception:
        return {"error": "invalid"}


if __name__ == "__main__":
    print(json.dumps(extract(), ensure_ascii=True))
