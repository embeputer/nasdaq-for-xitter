import { handleRequest } from '../../server/netlify.ts'

export default function handler(request: Request) {
  return handleRequest(request)
}
