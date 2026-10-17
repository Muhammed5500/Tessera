/** Bilinen cüzdanlar: KAHİN agent'ı ve demo trader agent'ları (agent/scripts/traders.ts). Aktivite akışında etiket olarak gösterilir. */
export const KNOWN_WALLETS: Record<string, string> = {
  "0x6b3882ed566e21d74cea2341895f442100e36212": "KAHİN agent",
  "0x175e3076ec6c43ea56bedf680c8d6a4c808d2df6": "Claude trader (demo)",
  "0x3eb012cb9ff0d8e80c946221d24ac2e255f5b6cf": "Momentum bot (demo)",
  "0xd0b273acf989ddf7723eb78f6e91144712c76a20": "Reversion bot (demo)",
  "0xc19bf898e9dd313791bb0e20705928d97a7b355b": "Spot bot (demo)",
  "0xcf5262739d469ff079073280f8f567b4993b4e00": "Tails bot (demo)",
  "0x71b5ec5874052afc69313cea317ae6040b5d8e1c": "Value bot (demo)",
  "0x2a5f0cbe7c1ac0951e628be95d81f86fb7b0d71d": "Contrarian bot (demo)",
};

export const walletLabel = (a: string) => KNOWN_WALLETS[a.toLowerCase()];
