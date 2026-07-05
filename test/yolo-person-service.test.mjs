import assert from "node:assert/strict";
import test from "node:test";
import {
  createPersonDetectionEvidence,
  parseYoloPersonJsonOutput
} from "../server/vision/yolo-person-service.mjs";

test("YOLO person service parses JSON after library setup output", () => {
  const parsed = parseYoloPersonJsonOutput([
    "Ultralytics settings v0.0.6",
    "Downloading https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo26n-seg.pt",
    '{"status":"completed","provider":"yolo","model":"yolo26n-seg.pt","boxes":[{"label":"person","confidence":0.87,"box":{"x":0.2,"y":0.1,"width":0.3,"height":0.6}}],"blurredImage":{"dataUrl":"data:image/jpeg;base64,abc","mimeType":"image/jpeg","size":123},"blurred":true}'
  ].join("\n"));

  assert.equal(parsed.status, "completed");
  assert.equal(parsed.provider, "yolo");
  assert.equal(parsed.boxes[0].label, "person");
  assert.equal(parsed.boxes[0].confidence, 0.87);
});

test("person detection evidence clamps invalid boxes and marks empty completed as no_person", () => {
  const evidence = createPersonDetectionEvidence({
    status: "completed",
    provider: "yolo",
    model: "yolo26n-seg.pt",
    boxes: [
      {
        label: "person",
        confidence: 1.7,
        box: { x: -0.2, y: 0.25, width: 1.4, height: 0.5 }
      },
      {
        label: "person",
        box: { x: 0.2, y: 0.2, width: 0, height: 0.3 }
      }
    ],
    image: { width: "1280", height: "720" },
    blurredImage: {
      dataUrl: "data:image/jpeg;base64,abc",
      mimeType: "image/jpeg",
      size: "123"
    },
    blurred: true
  });

  assert.equal(evidence.status, "completed");
  assert.equal(evidence.boxes.length, 1);
  assert.equal(evidence.boxes[0].confidence, 1);
  assert.equal(evidence.boxes[0].box.x, 0);
  assert.equal(evidence.boxes[0].box.width, 1);
  assert.equal(evidence.image.width, 1280);
  assert.equal(evidence.blurredImage.mimeType, "image/jpeg");
  assert.equal(evidence.blurredImage.size, 123);
  assert.equal(evidence.blurred, true);

  const empty = createPersonDetectionEvidence({ status: "completed", boxes: [] });
  assert.equal(empty.status, "no_person");
});
