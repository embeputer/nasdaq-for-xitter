import { runIngest } from '../../server/ingest.ts'

export default async function handler() {
  const summary = await runIngest()
  if (summary.filled || summary.refunded || summary.pending) {
    console.log(`ingest filled=${summary.filled} refunded=${summary.refunded} pending=${summary.pending}`)
  }
  return new Response(JSON.stringify(summary))
}

export const config = {
  schedule: '* * * * *',
}
