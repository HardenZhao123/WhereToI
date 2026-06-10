import { readFile } from "node:fs/promises";
import { mapRecordToToilet } from "../mapper/toilet-mapper.mjs";

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const [headers, ...records] = rows;

  return records
    .filter((record) => record.some((cell) => cell.trim() !== ""))
    .map((record) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = record[index] ?? "";
      });
      return object;
    });
}

export async function loadSeedToilets(csvPath) {
  let toilets = [];

  try {
    const csv = await readFile(csvPath, "utf8");
    const records = rowsToObjects(parseCsv(csv));
    toilets = records.map(mapRecordToToilet).filter(Boolean);
  } catch {
    toilets = [];
  }

  return toilets;
}
