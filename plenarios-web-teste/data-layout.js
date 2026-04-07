// Layouts de plenário (offline-friendly).
// Cada layout segue a contagem informada:
//  - Plenários 1–2: 12 cadeiras x 4 fileiras
//  - Plenários 3–14: 10 cadeiras x 4 fileiras
//  - Plenários 15–16: 5 cadeiras x 5 fileiras

function buildGridLayout(id, name, cols, rows) {
  const seats = [];
  const rowLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 1; r <= rows; r++) {
    const prefix = rowLabels[r - 1] || `R${r}`;
    for (let c = 1; c <= cols; c++) {
      const seatId = `${prefix}${c}`;
      seats.push({
        id: seatId,
        row: r,
        col: c,
        label: seatId
      });
    }
  }
  return { id, name, columns: cols, seats };
}

window.PLENARIO_LAYOUTS = [
  buildGridLayout("1-2", "Plenários 1 e 2", 12, 4),
  buildGridLayout("3-14", "Plenários 3 a 14", 10, 4),
  buildGridLayout("15-16", "Plenários 15 e 16", 5, 5)
];


