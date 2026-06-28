#!/usr/bin/env python3
import json
import os
import sys

os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_use_onednn", "0")
os.environ.setdefault("FLAGS_enable_pir_api", "0")
os.environ.setdefault("OMP_NUM_THREADS", "1")


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


def run_ocr(image_path):
    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        return {
            "status": "unavailable",
            "provider": "paddleocr",
            "error": f"PaddleOCR is not installed or could not be imported: {exc}"
        }

    try:
        # Prefer the stable PaddleOCR 2.x API used by the pinned Render
        # dependency set. Fall back to the newer 3.x API only if needed.
        try:
            ocr = PaddleOCR(
                lang="en",
                use_angle_cls=True,
                use_gpu=False,
                enable_mkldnn=False,
                show_log=False
            )
            result = ocr.ocr(image_path, cls=True)
        except TypeError:
            ocr = PaddleOCR(
                lang="en",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=True
            )
            result = ocr.predict(input=image_path)

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
