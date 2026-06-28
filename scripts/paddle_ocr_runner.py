#!/usr/bin/env python3
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import json
import os
import sys
from tempfile import TemporaryDirectory

os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_use_onednn", "0")
os.environ.setdefault("FLAGS_enable_pir_api", "0")
os.environ.setdefault("FLAGS_allocator_strategy", "auto_growth")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")

DEFAULT_OCR_MAX_IMAGE_DIMENSION = 960
DEFAULT_OCR_MAX_SOURCE_PIXELS = 12_000_000


class QuietWriter:
    def write(self, value):
        return len(str(value or ""))

    def flush(self):
        return None


@contextmanager
def quiet_library_output():
    sink = QuietWriter()
    with redirect_stdout(sink), redirect_stderr(sink):
        yield


def get_positive_int_env(name, default, minimum=1, maximum=100_000_000):
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def clamp_confidence(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def add_line(lines, text, confidence=None):
    safe_text = str(text or "").strip()
    if not safe_text:
        return
    lines.append({
        "text": safe_text,
        "confidence": clamp_confidence(confidence)
    })


def collect_lines_from_result(result):
    lines = []

    def visit(node):
        if node is None:
            return

        if isinstance(node, dict):
            rec_texts = node.get("rec_texts")
            rec_scores = node.get("rec_scores") or []
            if isinstance(rec_texts, list):
                for index, text in enumerate(rec_texts):
                    score = rec_scores[index] if index < len(rec_scores) else None
                    add_line(lines, text, score)
                return

            text = node.get("text") or node.get("transcription")
            if text:
                add_line(lines, text, node.get("confidence") or node.get("score"))
                return

            for value in node.values():
                visit(value)
            return

        if isinstance(node, (list, tuple)):
            if len(node) >= 2 and isinstance(node[1], (list, tuple)) and len(node[1]) >= 2:
                text_candidate = node[1][0]
                score_candidate = node[1][1]
                if isinstance(text_candidate, str):
                    add_line(lines, text_candidate, score_candidate)
                    return

            if len(node) >= 2 and isinstance(node[0], str):
                add_line(lines, node[0], node[1])
                return

            for item in node:
                visit(item)

    visit(result)
    return lines


@contextmanager
def prepare_image_for_ocr(image_path):
    try:
        from PIL import Image, ImageOps
    except Exception as exc:
        raise RuntimeError(f"OCR image pre-processing is unavailable: {exc}") from exc

    max_dimension = get_positive_int_env(
        "WHERETOI_PADDLEOCR_MAX_IMAGE_DIMENSION",
        DEFAULT_OCR_MAX_IMAGE_DIMENSION,
        minimum=320,
        maximum=2000
    )
    max_source_pixels = get_positive_int_env(
        "WHERETOI_PADDLEOCR_MAX_SOURCE_PIXELS",
        DEFAULT_OCR_MAX_SOURCE_PIXELS,
        minimum=1_000_000,
        maximum=40_000_000
    )

    try:
        with Image.open(image_path) as source_image:
            image = ImageOps.exif_transpose(source_image)
            width, height = image.size
            if width < 1 or height < 1:
                raise RuntimeError("OCR image has invalid dimensions.")
            if width * height > max_source_pixels:
                raise RuntimeError(
                    f"OCR image is too large to process safely ({width}x{height})."
                )

            image = image.convert("RGB")
            if max(width, height) > max_dimension:
                resample_filter = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
                image.thumbnail((max_dimension, max_dimension), resample_filter)

            with TemporaryDirectory(prefix="wheretoi-ocr-input-") as directory:
                prepared_path = os.path.join(directory, "submission-ocr.jpg")
                image.save(prepared_path, "JPEG", quality=86, optimize=True)
                yield prepared_path
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Could not prepare image for OCR: {exc}") from exc


def run_ocr(image_path):
    try:
        prepared_image_context = prepare_image_for_ocr(image_path)
        prepared_image = prepared_image_context.__enter__()
    except Exception as exc:
        return {
            "status": "failed",
            "provider": "paddleocr",
            "error": str(exc)
        }

    try:
        with quiet_library_output():
            from paddleocr import PaddleOCR
    except Exception as exc:
        prepared_image_context.__exit__(None, None, None)
        return {
            "status": "unavailable",
            "provider": "paddleocr",
            "error": f"PaddleOCR is not installed or could not be imported: {exc}"
        }

    try:
        try:
            with quiet_library_output():
                import paddle
                paddle.set_flags({
                    "FLAGS_use_mkldnn": False,
                    "FLAGS_allocator_strategy": "auto_growth"
                })
        except Exception:
            pass

        # Prefer the stable PaddleOCR 2.x API used by the pinned Render
        # dependency set. Fall back to the newer 3.x API only if needed.
        try:
            with quiet_library_output():
                ocr = PaddleOCR(
                    lang="en",
                    use_angle_cls=True,
                    use_gpu=False,
                    enable_mkldnn=False,
                    show_log=False
                )
                result = ocr.ocr(prepared_image, cls=True)
        except TypeError:
            with quiet_library_output():
                ocr = PaddleOCR(
                    lang="en",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=True
                )
                result = ocr.predict(input=prepared_image)

        lines = collect_lines_from_result(result)
        confidence_values = [
            line["confidence"] for line in lines
            if isinstance(line.get("confidence"), (int, float))
        ]
        confidence = (
            sum(confidence_values) / len(confidence_values)
            if confidence_values
            else None
        )
        return {
            "status": "completed",
            "provider": "paddleocr",
            "text": "\n".join(line["text"] for line in lines),
            "lines": lines,
            "confidence": confidence
        }
    except Exception as exc:
        return {
            "status": "failed",
            "provider": "paddleocr",
            "error": str(exc)
        }
    finally:
        prepared_image_context.__exit__(None, None, None)


def main():
    if len(sys.argv) != 2:
        print(json.dumps({
            "status": "failed",
            "provider": "paddleocr",
            "error": "Usage: paddle_ocr_runner.py <image-path>"
        }))
        return 2

    print(json.dumps(run_ocr(sys.argv[1]), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
