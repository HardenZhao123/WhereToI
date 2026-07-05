#!/usr/bin/env python3
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from io import BytesIO
import base64
import json
import os
import sys

DEFAULT_PERSON_MODEL = "yolo26n-seg.pt"
DEFAULT_PERSON_CONFIDENCE = 0.25
DEFAULT_PERSON_BLUR_RADIUS = 18


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


def get_confidence_env(name, default):
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(0.01, min(0.99, value))


def clamp_unit(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def get_positive_float_env(name, default, minimum=1.0, maximum=100.0):
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def encode_jpeg_data_url(image):
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=86, optimize=True)
    data = buffer.getvalue()
    encoded = base64.b64encode(data).decode("ascii")
    return {
        "dataUrl": f"data:image/jpeg;base64,{encoded}",
        "mimeType": "image/jpeg",
        "size": len(data)
    }


def get_mask_polygons(result):
    if result.masks is None:
        return []

    polygons = []
    for polygon in getattr(result.masks, "xy", []) or []:
        points = []
        for point in polygon:
            if len(point) >= 2:
                points.append((float(point[0]), float(point[1])))
        polygons.append(points)
    return polygons


def create_blurred_person_image(image_path, boxes, polygons, blur_radius):
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except Exception as exc:
        return None, f"Person blur is unavailable because Pillow could not be imported: {exc}"

    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")
            width, height = image.size
            mask = Image.new("L", image.size, 0)
            draw = ImageDraw.Draw(mask)

            for index, box in enumerate(boxes):
                polygon = polygons[index] if index < len(polygons) else []
                if len(polygon) >= 3:
                    safe_polygon = [
                        (
                            max(0.0, min(float(width), x)),
                            max(0.0, min(float(height), y))
                        )
                        for x, y in polygon
                    ]
                    draw.polygon(safe_polygon, fill=255)
                    box["maskType"] = "segmentation"
                elif box.get("pixels"):
                    pixels = box["pixels"]
                    draw.rectangle(
                        [
                            max(0, min(width, int(pixels["x1"]))),
                            max(0, min(height, int(pixels["y1"]))),
                            max(0, min(width, int(pixels["x2"]))),
                            max(0, min(height, int(pixels["y2"])))
                        ],
                        fill=255
                    )
                    box["maskType"] = "bbox"

            if not mask.getbbox():
                return None, ""

            soft_mask = mask.filter(ImageFilter.GaussianBlur(radius=2))
            blurred_layer = image.filter(ImageFilter.GaussianBlur(radius=blur_radius))
            output = image.copy()
            output.paste(blurred_layer, mask=soft_mask)
            return encode_jpeg_data_url(output), ""
    except Exception as exc:
        return None, f"Could not blur detected people: {exc}"


def run_detection(image_path):
    model_name = os.environ.get("WHERETOI_YOLO_PERSON_MODEL", DEFAULT_PERSON_MODEL)
    confidence = get_confidence_env("WHERETOI_YOLO_PERSON_CONFIDENCE", DEFAULT_PERSON_CONFIDENCE)
    blur_radius = get_positive_float_env(
        "WHERETOI_YOLO_PERSON_BLUR_RADIUS",
        DEFAULT_PERSON_BLUR_RADIUS,
        minimum=3.0,
        maximum=80.0
    )

    try:
        with quiet_library_output():
            from ultralytics import YOLO
    except Exception as exc:
        return {
            "status": "unavailable",
            "provider": "yolo",
            "model": model_name,
            "error": f"Ultralytics YOLO is not installed or could not be imported: {exc}"
        }

    try:
        with quiet_library_output():
            model = YOLO(model_name)
            results = model.predict(
                source=image_path,
                classes=[0],
                conf=confidence,
                verbose=False
            )

        if not results:
            return {
                "status": "no_person",
                "provider": "yolo",
                "model": model_name,
                "boxes": [],
                "image": {"width": None, "height": None}
            }

        result = results[0]
        height, width = result.orig_shape if result.orig_shape else (None, None)
        boxes = []

        if result.boxes is not None:
            xyxy_values = result.boxes.xyxy.cpu().tolist()
            confidence_values = result.boxes.conf.cpu().tolist()
            for index, xyxy in enumerate(xyxy_values):
                if len(xyxy) < 4 or not width or not height:
                    continue

                x1, y1, x2, y2 = [float(value) for value in xyxy[:4]]
                x1 = max(0.0, min(float(width), x1))
                x2 = max(0.0, min(float(width), x2))
                y1 = max(0.0, min(float(height), y1))
                y2 = max(0.0, min(float(height), y2))
                if x2 <= x1 or y2 <= y1:
                    continue

                box_width = x2 - x1
                box_height = y2 - y1
                boxes.append({
                    "label": "person",
                    "confidence": clamp_unit(confidence_values[index] if index < len(confidence_values) else None),
                    "box": {
                        "x": clamp_unit(x1 / width),
                        "y": clamp_unit(y1 / height),
                        "width": clamp_unit(box_width / width),
                        "height": clamp_unit(box_height / height)
                    },
                    "pixels": {
                        "x1": round(x1),
                        "y1": round(y1),
                        "x2": round(x2),
                        "y2": round(y2)
                    }
                })

        polygons = get_mask_polygons(result)
        blurred_image, blur_error = (
            create_blurred_person_image(image_path, boxes, polygons, blur_radius)
            if boxes
            else (None, "")
        )

        return {
            "status": "completed" if boxes else "no_person",
            "provider": "yolo",
            "model": model_name,
            "boxes": boxes,
            "image": {"width": width, "height": height},
            "blurredImage": blurred_image,
            "blurred": bool(blurred_image),
            "blurError": blur_error
        }
    except Exception as exc:
        return {
            "status": "failed",
            "provider": "yolo",
            "model": model_name,
            "error": str(exc)
        }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({
            "status": "failed",
            "provider": "yolo",
            "model": os.environ.get("WHERETOI_YOLO_PERSON_MODEL", DEFAULT_PERSON_MODEL),
            "error": "Usage: yolo_person_runner.py <image-path>"
        }))
        return 2

    print(json.dumps(run_detection(sys.argv[1]), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
