import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createYoloPersonDetectionService,
  createPersonDetectionEvidence,
  getYoloPersonExecutionTimeoutMs,
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

test("YOLO person service keeps the cold timeout for non-reused Python processes", () => {
  assert.equal(
    getYoloPersonExecutionTimeoutMs({
      timeoutMs: 45_000,
      coldTimeoutMs: 180_000,
      warmedUp: false
    }),
    180_000
  );
  assert.equal(
    getYoloPersonExecutionTimeoutMs({
      timeoutMs: 45_000,
      coldTimeoutMs: 180_000,
      warmedUp: true
    }),
    180_000
  );
  assert.equal(
    getYoloPersonExecutionTimeoutMs({
      timeoutMs: 45_000,
      coldTimeoutMs: 180_000,
      warmedUp: true,
      reusesProcess: true
    }),
    45_000
  );
});

test("YOLO person service starts one persistent worker and reuses its loaded model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-yolo-worker-test-"));
  const runnerPath = join(directory, "fake-yolo-worker.mjs");
  const workerSource = `
    import { createInterface } from "node:readline";
    let requestCount = 0;
    process.stdout.write(JSON.stringify({
      type: "ready",
      status: "completed",
      provider: "yolo",
      model: "fake-seg.pt"
    }) + "\\n");
    const input = createInterface({ input: process.stdin });
    input.on("line", (line) => {
      const request = JSON.parse(line);
      requestCount += 1;
      process.stdout.write(JSON.stringify({
        type: "result",
        id: request.id,
        result: {
          status: "no_person",
          provider: "yolo",
          model: "fake-seg.pt",
          boxes: [],
          image: { width: requestCount, height: 1 }
        }
      }) + "\\n");
    });
  `;
  const service = createYoloPersonDetectionService({
    enabled: true,
    pythonCommand: process.execPath,
    runnerPath,
    timeoutMs: 1_000,
    coldTimeoutMs: 2_000,
    warmupTimeoutMs: 2_000
  });

  try {
    await writeFile(runnerPath, workerSource, "utf8");

    const startup = await service.start();
    assert.equal(startup.status, "completed");
    assert.equal(service.warmedUp, true);
    assert.equal(service.getExecutionTimeoutMs(), 1_000);

    const first = await service.detectPeople({
      dataUrl: "data:image/jpeg;base64,/9j/"
    });
    const second = await service.detectPeople({
      dataUrl: "data:image/jpeg;base64,/9j/"
    });

    assert.equal(first.status, "no_person");
    assert.equal(first.image.width, 1);
    assert.equal(second.status, "no_person");
    assert.equal(second.image.width, 2);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
