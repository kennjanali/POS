# POS@034

Offline-first point of sale for small Philippine restaurants, sold and installed one store at
a time on an Android tablet with a Bluetooth receipt printer.

**Status: being reworked into a sellable product.** The code in `src/` is still the working
single-store web build it grew out of. Nothing described in the plans below is built yet.

- [REWORK-PLAN.md](REWORK-PLAN.md): why, what and in what order (phases, decisions, BIR, licensing, landing page)
- [TECH-STACK.md](TECH-STACK.md): what we build with: Keep / Rework / Remove / Add

## Run the current build

```bash
npm install
npm run dev        # http://localhost:3000
npm run check      # typecheck + lint + tax, auth, demo and safeguard checks
```

No backend needed. Data lives in the browser (IndexedDB).

The previous README and AUDIT (KRAMGEN v7) are in git history at commit `226e22c`.
