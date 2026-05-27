export const fallbackToilets = [
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
    hours: { today: "Tue 09:00 - 17:00", sat: "Sat Closed", sun: "Sun Closed" }
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
    hours: { today: "Tue 06:00 - 23:30", sat: "Sat 07:00 - 23:30", sun: "Sun 08:00 - 22:30" }
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
    hours: { today: "Tue 08:30 - 23:00", sat: "Sat 10:00 - 20:00", sun: "Sun 10:00 - 20:00" }
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
    hours: { today: "Tue 10:00 - 18:00", sat: "Sat 10:00 - 18:00", sun: "Sun 10:00 - 17:00" }
  }
];
