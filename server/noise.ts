import { nextShockDelay } from './launch.ts'
import { store as openLedger } from './store.ts'

export function startNoise(): void {
  const flag = globalThis as { larpNoise?: boolean }
  if (flag.larpNoise || process.env.VITEST) return
  flag.larpNoise = true
  const arm = () => {
    setTimeout(() => {
      void openLedger()
        .then((ledger) => ledger.shockNoise(Date.now()))
        .catch((error: unknown) => {
          console.error('noise', error instanceof Error ? error.message : 'failed')
        })
        .finally(arm)
    }, nextShockDelay(Math.random))
  }
  void openLedger()
    .then((ledger) => ledger.shockNoise(Date.now()))
    .catch((error: unknown) => {
      console.error('noise', error instanceof Error ? error.message : 'failed')
    })
    .finally(arm)
}
