import { readFile } from "node:fs/promises";
import { mapRecordToToilet } from "../mapper/toilet-mapper.mjs";

const fallbackToilets = [
  {
    id: "city",
    name: "City and Guilds building",
    area: "Imperial College London",
    lat: 51.49876,
    lng: -0.17687,
    paid: false,
    cleanliness: 8,
    comment: "Comment: clean today, short queue.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "N",
      neutral: "?",
      children: "?",
      babyChanging: "N",
      bidet: "?",
      automatic: "?",
      urinalOnly: "N",
      radarKey: "?",
      free: "Y"
    },
    openingTimes: []
  },
  {
    id: "station",
    name: "South Kensington Station",
    area: "Partner paid toilet",
    lat: 51.49412,
    lng: -0.17392,
    paid: true,
    cleanliness: 6,
    comment: "Comment: QR gate required, usually busy after lectures.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "N",
      children: "?",
      babyChanging: "?",
      bidet: "Y",
      automatic: "?",
      urinalOnly: "N",
      radarKey: "?",
      free: "N"
    },
    openingTimes: []
  },
  {
    id: "library",
    name: "Imperial Library",
    area: "Campus access",
    lat: 51.49818,
    lng: -0.17821,
    paid: false,
    cleanliness: 7,
    comment: "Comment: open late with accessible facilities nearby.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "Y",
      children: "Y",
      babyChanging: "Y",
      bidet: "?",
      automatic: "N",
      urinalOnly: "N",
      radarKey: "?",
      free: "Y"
    },
    openingTimes: []
  },
  {
    id: "museum",
    name: "Museum Quarter",
    area: "Public toilet",
    lat: 51.49661,
    lng: -0.17222,
    paid: false,
    cleanliness: 9,
    comment: "Comment: free access, closes early on Sundays.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "N",
      children: "Y",
      babyChanging: "Y",
      bidet: "?",
      automatic: "N",
      urinalOnly: "N",
      radarKey: "?",
      free: "Y"
    },
    openingTimes: []
  }
];

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

  if (toilets.length === 0) {
    toilets = fallbackToilets;
  }

  return toilets;
}
