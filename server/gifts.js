// Virtual gift catalog. Sparks are a cosmetic, closed-loop in-app currency —
// no real money is ever involved. Everyone starts with a free balance
// (see profiles.sparks default in db.js); sending a gift spends the
// sender's sparks and logs the gift on the recipient's profile — it does
// not mint new sparks for the recipient (keeps the economy simple & sane).

export const GIFT_CATALOG = [
  { key: "rose", emoji: "🌹", name: "Rose", cost: 10 },
  { key: "coffee", emoji: "☕", name: "Coffee", cost: 15 },
  { key: "chocolate", emoji: "🍫", name: "Chocolate", cost: 25 },
  { key: "teddy", emoji: "🧸", name: "Teddy Bear", cost: 50 },
  { key: "bouquet", emoji: "💐", name: "Bouquet", cost: 75 },
  { key: "ring", emoji: "💍", name: "Ring", cost: 150 },
  { key: "diamond", emoji: "💎", name: "Diamond", cost: 200 },
  { key: "crown", emoji: "👑", name: "Crown", cost: 300 },
];

export const GIFT_BY_KEY = Object.fromEntries(GIFT_CATALOG.map((g) => [g.key, g]));
