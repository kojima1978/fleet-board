export const parkingSpotGeometry = [
  ...[269.6, 360.6, 451.6, 542.6, 633.6, 724.6, 815.6].map((x, i) => ({ code: String(i + 1).padStart(2, "0"), x: x / 9.5, y: 385.334 / 5.25, width: 66.8 / 9.5, height: 110.8 / 5.25, orientation: "vertical" })),
  ...[269.6, 395.6, 521.6, 647.6, 771.6].map((x, i) => ({ code: String(i + 8).padStart(2, "0"), x: x / 9.5, y: 304.334 / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...[269.6, 395.6, 521.6, 647.6].map((x, i) => ({ code: String(i + 13).padStart(2, "0"), x: x / 9.5, y: 222.334 / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...[269.6, 393.6, 521.6].map((x, i) => ({ code: String(i + 17).padStart(2, "0"), x: x / 9.5, y: 141.334 / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...["24", "26", "32"].map((code, i) => ({ code, x: 54.6 / 9.5, y: [220.334, 304.334, 429.334][i] / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...["20", "21"].map((code, i) => ({ code, x: [269.6, 360.6][i] / 9.5, y: 16.6 / 5.25, width: 66.8 / 9.5, height: 110.8 / 5.25, orientation: "vertical" })),
  ...["23", "22"].map((code, i) => ({ code, x: 54.6 / 9.5, y: [16.6, 95.6][i] / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
] as const;
